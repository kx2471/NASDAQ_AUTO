import fs from 'fs/promises';
import path from 'path';
import { getOpenPositions, updatePosition, reconcileWithToss, applyDecisionToPositions, Position } from '../storage/positions';
import { getPrices, getActiveRegularSession, getSellableQuantity } from '../services/toss';
import { executeSell } from '../services/trading';
import { ManagerDecision } from '../services/decision';

/**
 * SL/TP 실시간 감시자 (정규장 전용)
 *
 * 손절·익절가를 지정가로 선주문하지 않고, 정규장 동안 실시간 가격을 확인하며
 * 조건 도달 시 그 자리에서 주문한다 (사용자 정책):
 *  - 현재가 ≤ stop_loss      → 전량 시장가 매도 (손절)
 *  - 현재가 ≥ take_profit_2  → 잔량 전량 매도 (2차 익절)
 *  - 현재가 ≥ take_profit_1  → 절반 매도 + tp1_done 기록 (1차 익절)
 *
 * - 스케줄러가 정규장 중 매분 checkPositionsOnce()를 호출한다.
 * - 같은 심볼에 대한 중복 주문은 in-flight 가드 + 체결 후 reconcile로 방지.
 * - 모든 주문은 trading.ts 가드레일과 dry-run 게이트를 그대로 거친다.
 */

// 주문 진행 중인 심볼 (한 틱에서 주문 나간 심볼은 reconcile 전까지 재주문 금지)
const inFlight = new Set<string>();

// 체결 정착 재확인 대기 (심볼 → 매도 시각 ms).
// 매도 직후 reconcile은 토스가 체결을 반영하기 전에 실행돼 옛 수량을 되읽는 경우가 있다.
// 그 뒤 judge()가 null을 반환하면(예: TP1 완료·TP2 미달·SL 미달) 다시 동기화할 경로가
// 없어 positions.json이 영구히 어긋난다 (2026-08-13 SMCI TP1: 잔량 0.317인데 0.634로 남음).
// 여기 등록된 심볼은 유예 시간이 지난 첫 틱에서 한 번 더 reconcile한다.
const pendingSettleCheck = new Map<string, number>();
const SETTLE_RECHECK_MS = 60 * 1000; // 토스 반영 유예 — 1분이면 충분(실측 기준)

// 마감 1시간 전 소수점 주문 차단을 이미 알린 심볼 (세션당 1회만 로그)
const fractionalWarned = new Set<string>();
let fractionalWarnedSession = 0;

/**
 * 소수점 주문 마감(정규장 종료 -1h) 직전에 '마지막 출구'를 열어두는 시간.
 * 이 구간 동안 손절선에 근접한 소수점 포지션은 선제 청산 대상이 된다.
 * 5분: 매분 틱이므로 한 번 실패해도 4번 더 기회가 있고, 정상 매매를 방해할 만큼 길지 않다.
 */
const PRE_CUTOFF_WINDOW_MS = 5 * 60 * 1000;

/**
 * 선제 청산 발동 거리 — 현재가가 손절선 위 이 비율 이내면 "위험"으로 본다.
 * 기본 2%. 마감 1시간 동안 2% 더 빠지면 어차피 손절이었을 포지션을,
 * 주문이 가능한 마지막 순간에 정리한다. FRACTIONAL_EXIT_BUFFER_PCT로 조정 가능.
 */
function getFractionalExitBufferPct(): number {
  const v = parseFloat(process.env.FRACTIONAL_EXIT_BUFFER_PCT || '');
  return Number.isFinite(v) && v >= 0 ? v : 2;
}

// 이번 세션에 선제 청산을 이미 시도한 심볼 (반복 주문 방지)
const preCutoffExited = new Set<string>();

/**
 * 체결 지연 자가 치유 (매분, 정규장 중)
 *
 * 시장가 주문도 체결→보유 반영에 지연이 있어, 집행 직후 1회 동기화만으로는
 * 포지션·SL/TP 계획 부착이 누락될 수 있다 (2026-07-13 COMP 사례).
 * 최근 24시간 내 결정의 BUY 종목 중 "계획 미부착" 종목이 있으면
 * 토스 reconcile + 결정 재적용으로 복구한다.
 *
 * - 정상 상태면 로컬 파일 검사만 하고 종료 (API 호출 0회)
 * - 이미 손절 등으로 청산된 종목은 reconcile이 CLOSED 처리하므로 재부착되지 않음
 */
export async function syncPendingFills(): Promise<void> {
  let decisions: ManagerDecision[];
  try {
    const raw = await fs.readFile(path.join(process.cwd(), 'data', 'json', 'decisions.json'), 'utf-8');
    decisions = JSON.parse(raw);
  } catch {
    return; // 결정 기록 없음
  }
  if (!Array.isArray(decisions) || decisions.length === 0) return;

  // 최근 24시간 내 결정만 대상 (오래된 결정을 새 포지션에 재적용하지 않도록)
  const latest = decisions[decisions.length - 1];
  const ageMs = Date.now() - new Date(latest.decided_at).getTime();
  if (!isFinite(ageMs) || ageMs > 24 * 60 * 60 * 1000) return;

  // 집행 결과가 기록됐다면 REJECTED/SKIPPED 심볼은 제외 — 체결이 영원히 없으므로
  // 매분 재동기화(토스 재조회)를 반복하는 낭비를 막는다 (2026-07-23 LQDA 거부에서 실측)
  const notFilled = new Set(
    (latest.execution_outcomes || [])
      .filter(o => o.action === 'BUY' && o.status !== 'FILLED')
      .map(o => o.symbol)
  );
  const buySymbols = latest.actions
    .filter(a => a.action === 'BUY' && !notFilled.has(a.symbol) && (a.stop_loss || a.take_profit_1 || a.take_profit_2))
    .map(a => a.symbol);
  if (buySymbols.length === 0) return;

  // 로컬 검사: 계획이 붙은 OPEN 포지션이 전부 있으면 아무것도 안 함
  const positions = await getOpenPositions();
  const planned = new Set(
    positions.filter(p => p.stop_loss || p.take_profit_1 || p.take_profit_2).map(p => p.symbol)
  );
  const missing = buySymbols.filter(s => !planned.has(s));
  if (missing.length === 0) return;

  console.log(`🔁 체결 동기화: ${missing.join(', ')} 계획 미부착 — 토스 재조회 후 결정 재적용`);
  try {
    await reconcileWithToss();
    await applyDecisionToPositions(latest);
  } catch (error: any) {
    console.warn('⚠️ 체결 동기화 실패 (다음 분에 재시도):', error.message);
  }
}

/**
 * 포지션 1개에 대한 SL/TP 판정 (순수 함수 — 테스트 가능하도록 export)
 * @returns 실행할 액션 (없으면 null)
 */
export function judge(position: Position, price: number):
  { type: 'STOP_LOSS' | 'TP2' | 'TP1'; qty: number; reason: string } | null {

  // 손절 최우선 — 익절가와 동시에 걸리는 비정상 상황에서도 방어적으로 손절
  if (position.stop_loss && price <= position.stop_loss) {
    return {
      type: 'STOP_LOSS',
      qty: position.shares,
      reason: `손절: 현재가 $${price} ≤ SL $${position.stop_loss}`
    };
  }

  if (position.take_profit_2 && price >= position.take_profit_2) {
    return {
      type: 'TP2',
      qty: position.shares,
      reason: `2차 익절: 현재가 $${price} ≥ TP2 $${position.take_profit_2}`
    };
  }

  if (position.take_profit_1 && !position.tp1_done && price >= position.take_profit_1) {
    // 절반 매도 (소수점 보유 대비 내림, 1주 미만이면 전량)
    // 절반 매도: 정수 보유는 내림(floor), 소수점 보유는 소수점 절반
    // (토스는 시장가 매도에 소수점 6자리까지 허용 — 소수점 포지션도 2단계 익절 유지)
    const half = position.shares >= 2
      ? Math.floor(position.shares / 2)
      : Math.floor((position.shares / 2) * 1e6) / 1e6;
    return {
      type: 'TP1',
      qty: half > 0 ? half : position.shares,
      reason: `1차 익절: 현재가 $${price} ≥ TP1 $${position.take_profit_1}`
    };
  }

  return null;
}

/**
 * 소수점 주문 마감 직전, 손절선에 근접한 소수점 포지션의 선제 청산 판정 (순수 함수).
 *
 * 왜 필요한가: 토스는 소수점 매도를 **정규장 종료 1시간 전까지만** 접수한다.
 * 04:00~05:00 KST에 손절선이 깨지면 판정은 되는데 집행이 불가능하고, 포지션은
 * 다음 개장(다음 날 22:30)까지 무방비로 남는다 — 갭다운을 그대로 맞는다.
 * 소액 계좌는 1주 가격이 보유액을 넘는 종목이 많아 대부분 포지션이 소수점이라
 * 이 구멍이 상시 열려 있다.
 *
 * 무엇을 하는가: 주문이 가능한 마지막 몇 분에, 이미 손절선 코앞(기본 2% 이내)까지
 * 온 포지션만 정리한다. 이익 중이거나 손절선에서 먼 포지션은 건드리지 않는다 —
 * "마감 전 전량 청산"은 승자까지 끊어 규칙 9(승자 보유 연장)와 정면으로 충돌한다.
 *
 * 트레이드오프(의도적): 마감 1시간 동안 반등해 손절을 면했을 포지션도 정리된다.
 * 대신 밤새 갭다운 노출을 없앤다. 손절선 2% 이내까지 밀린 상태라면 후자의 손실
 * 기대값이 더 크다고 보고 방어를 택했다.
 *
 * @param position 보유 포지션 (stop_loss 계획 포함)
 * @param price    현재가
 * @param bufferPct 손절선 위 몇 %까지를 '위험'으로 볼지
 * @returns 청산할 액션 (해당 없으면 null)
 */
export function judgePreCutoffExit(position: Position, price: number, bufferPct: number):
  { type: 'STOP_LOSS'; qty: number; reason: string } | null {

  if (!position.stop_loss || position.stop_loss <= 0) return null;
  if (Number.isInteger(position.shares)) return null;  // 정수 포지션은 마감까지 매도 가능 — 서두를 이유 없음
  if (price <= position.stop_loss) return null;        // 이미 손절선 아래 = judge()가 정규 손절로 처리

  const threshold = position.stop_loss * (1 + bufferPct / 100);
  if (price > threshold) return null;                  // 아직 여유 있음 — 보유 유지

  const gapPct = ((price - position.stop_loss) / position.stop_loss) * 100;
  return {
    type: 'STOP_LOSS',
    qty: position.shares,
    reason: `마감 전 선제 청산: 현재가 $${price}가 SL $${position.stop_loss} +${gapPct.toFixed(1)}% 이내 — ` +
            `소수점 매도 마감 이후에는 손절 집행이 불가능하다`
  };
}

/**
 * 전체 OPEN 포지션 1회 점검 — 조건 도달 시 매도 주문
 * - 정규장이 아니면 아무것도 하지 않는다
 */
export async function checkPositionsOnce(): Promise<void> {
  // 소수점 수량 주문은 토스 정책상 **정규장 종료 1시간 전까지만** 접수된다.
  // (2026-09-02 04:05 MRNA TP1 실측: 422 fractional-quantity-outside-regular-hours,
  //  orderableHours가 22:30~04:00으로 정규장 05:00보다 1시간 짧다)
  // 소액 계좌는 대부분 포지션이 소수점이라, 이 구간에 트리거가 걸리면 판정은 되는데
  // 집행이 안 되고 매분 422를 반복한다. 헛된 재시도로 API를 두드리지 않도록 스킵한다.
  const session = await getActiveRegularSession();
  if (!session) return;
  const now = Date.now();
  const fractionalCutoff = session.end - 60 * 60 * 1000;
  const fractionalBlocked = now >= fractionalCutoff;
  // 마감 직전 '마지막 출구' 구간 — 소수점 주문이 아직 접수되는 마지막 몇 분.
  // 여기서 손절선에 근접한 소수점 포지션을 선제 청산한다 (아래 preCloseExit 참조).
  const lastExitWindow = now >= fractionalCutoff - PRE_CUTOFF_WINDOW_MS && now < fractionalCutoff;
  // 세션이 바뀌면 경고 기록 초기화 (안 그러면 다음 날 알림이 뜨지 않는다)
  if (fractionalWarnedSession !== session.start) {
    fractionalWarnedSession = session.start;
    fractionalWarned.clear();
    preCutoffExited.clear();
  }

  // 체결 정착 재확인 — 직전 매도의 reconcile이 너무 일렀을 수 있으므로 유예 후 1회 더 맞춘다.
  // 포지션 조회보다 먼저 해야 이번 틱의 판정이 정정된 수량을 쓴다.
  if (pendingSettleCheck.size > 0) {
    const due = [...pendingSettleCheck.entries()].filter(([, at]) => Date.now() - at >= SETTLE_RECHECK_MS);
    if (due.length > 0) {
      for (const [symbol] of due) pendingSettleCheck.delete(symbol);
      try {
        await reconcileWithToss();
        console.log(`🔄 체결 정착 재확인 완료: ${due.map(([s]) => s).join(', ')}`);
      } catch (error: any) {
        console.warn('⚠️ 체결 정착 재확인 실패 (다음 틱에 재시도):', error.message);
        for (const [symbol, at] of due) pendingSettleCheck.set(symbol, at); // 되돌려 재시도
      }
    }
  }

  const positions = (await getOpenPositions()).filter(p =>
    p.currency !== 'KRW' &&                       // 미국 주식만 감시
    (p.stop_loss || p.take_profit_1 || p.take_profit_2) &&
    p.shares > 0 &&
    !inFlight.has(p.symbol)
  );
  if (positions.length === 0) return;

  // 감시 대상 전체 현재가 1콜 조회
  const prices = await getPrices(positions.map(p => p.symbol));

  for (const position of positions) {
    const price = prices[position.symbol];
    if (!price) continue;

    let action = judge(position, price);

    // 소수점 매도 마감 직전 — 손절선 코앞까지 온 소수점 포지션을 마지막으로 정리한다.
    // (정규 판정에 걸린 게 없을 때만. 손절/익절이 이미 걸렸으면 그쪽이 우선)
    if (!action && lastExitWindow && !preCutoffExited.has(position.symbol)) {
      const exit = judgePreCutoffExit(position, price, getFractionalExitBufferPct());
      if (exit) {
        preCutoffExited.add(position.symbol);
        action = exit;
      }
    }
    if (!action) continue;

    // 소수점 수량 + 마감 1시간 이내 = 토스가 접수하지 않는다.
    if (fractionalBlocked && !Number.isInteger(action.qty)) {
      // 정수부가 1주 이상이면 그만큼이라도 던져 손실을 줄인다 (부분 방어).
      // 손절에만 적용한다 — 익절을 놓치는 건 기회 손실이지만, 손절을 놓치는 건 실손실이다.
      const wholeShares = Math.floor(action.qty);
      if (action.type === 'STOP_LOSS' && wholeShares >= 1) {
        console.warn(
          `⚠️ ${position.symbol} ${action.reason} — 소수점 매도 마감 이후. ` +
          `정수분 ${wholeShares}주만 부분 손절하고 잔량 ${(action.qty - wholeShares).toFixed(6)}주는 다음 개장에 재판정한다.`
        );
        action = { ...action, qty: wholeShares };
      } else {
        if (!fractionalWarned.has(position.symbol)) {
          fractionalWarned.add(position.symbol);
          console.warn(
            `⏸️ ${position.symbol} ${action.reason} — 소수점 수량(${action.qty})은 마감 1시간 전(${new Date(fractionalCutoff).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} KST) 이후 주문 불가. ` +
            `이번 세션 집행 보류 — 다음 개장 후 재판정한다.`
          );
        }
        continue;
      }
    }

    console.log(`🔔 ${position.symbol} ${action.reason} → ${action.qty}주 시장가 매도`);
    inFlight.add(position.symbol);

    try {
      // 실제 매도 가능 수량으로 보정 (주문 중 물량 등 차감분 반영)
      const sellable = await getSellableQuantity(position.symbol);
      const qty = Math.min(action.qty, sellable);
      if (qty <= 0) {
        // 매도가능 0인데 포지션은 OPEN = 이상 상태. 대표 원인: 직전 SL/TP 시장가 주문의
        // 체결 반영 지연 — 주문 직후 reconcile 시점엔 토스 보유에 아직 남아 있어 OPEN 유지됨.
        // 여기서 다시 동기화해 이미 청산된 유령 포지션이면 CLOSED 처리 (매분 재트리거 차단).
        console.warn(`⚠️ ${position.symbol} 매도 가능 수량 없음 — 토스와 재동기화 (체결 지연/유령 포지션 정리)`);
        await reconcileWithToss();
        continue;
      }

      const result = await executeSell({
        symbol: position.symbol,
        qty,
        orderType: 'MARKET',
        note: action.reason
      });

      if (result.success) {
        console.log(`✅ ${position.symbol} ${action.type} 주문 완료 ${result.dryRun ? '[DRY-RUN]' : `(주문번호 ${result.orderId})`}`);
        if (action.type === 'TP1') {
          await updatePosition(position.symbol, { tp1_done: true });
        }
        // 실주문이면 보유 수량 변동을 즉시 동기화 (dry-run은 잔고가 안 변하므로 생략).
        // 이 시점 reconcile은 토스 반영 전일 수 있으므로 정착 재확인도 함께 예약한다.
        if (!result.dryRun) {
          await reconcileWithToss();
          pendingSettleCheck.set(position.symbol, Date.now());
        }
      } else {
        console.warn(`⚠️ ${position.symbol} ${action.type} 주문 거부: ${result.error}`);
      }
    } catch (error: any) {
      console.error(`❌ ${position.symbol} SL/TP 주문 오류:`, error.message);
    } finally {
      inFlight.delete(position.symbol);
    }
  }
}
