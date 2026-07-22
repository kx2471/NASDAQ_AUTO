import fs from 'fs/promises';
import path from 'path';
import { getOpenPositions, updatePosition, reconcileWithToss, applyDecisionToPositions, Position } from '../storage/positions';
import { getPrices, isUsRegularSessionOpen, getSellableQuantity } from '../services/toss';
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

  const buySymbols = latest.actions
    .filter(a => a.action === 'BUY' && (a.stop_loss || a.take_profit_1 || a.take_profit_2))
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
 * 전체 OPEN 포지션 1회 점검 — 조건 도달 시 매도 주문
 * - 정규장이 아니면 아무것도 하지 않는다
 */
export async function checkPositionsOnce(): Promise<void> {
  if (!(await isUsRegularSessionOpen())) return;

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

    const action = judge(position, price);
    if (!action) continue;

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
        // 실주문이면 보유 수량 변동을 즉시 동기화 (dry-run은 잔고가 안 변하므로 생략)
        if (!result.dryRun) {
          await reconcileWithToss();
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
