import { db, Trade, getHoldings, Holding } from './database';
import { ManagerDecision } from '../services/decision';

/**
 * 포지션(Position) 저장소
 *
 * 토스 실계좌는 "지금 몇 주를 평단 얼마에 들고 있나(shares/avg_cost)"만 안다.
 * "언제 샀나 / 손절·익절가 / 보유 예정 기간 / 매수 근거"는 토스가 모르는 **앱의 의도**다.
 * 이 파일은 그 의도를 보관하고, 토스 보유종목(진실)과 동기화한다.
 *
 * - positions.json: 심볼별 1개 포지션(현재 보유 + 계획)
 * - 토스 = 진실(shares/avg_cost), 앱 = 의도(SL/TP/horizon/근거)
 */

/** 포지션(보유 종목 + 매매 계획) */
export interface Position {
  symbol: string;
  status: 'OPEN' | 'CLOSED';
  shares: number;              // 보유 수량 (토스 reconcile)
  avg_cost: number;            // 매수 평균가 (토스 reconcile)
  currency?: string;           // 거래 통화 (토스 reconcile, 예: 'USD'/'KRW')
  opened_at: string;           // 최초 진입 시각 (trades에서 유도)
  source_report_id?: string;   // 어느 Manager 결정으로 진입했나

  // 매매 계획 (Manager 결정에서 채워짐) — 토스가 모르는 정보
  // SL/TP는 선주문하지 않고, 정규장 중 감시자(watcher)가 실시간 가격을 확인해 조건 도달 시 주문한다
  stop_loss?: number;          // 손절가 (도달 시 전량 시장가 매도)
  take_profit_1?: number;      // 1차 익절가 (도달 시 절반 매도)
  take_profit_2?: number;      // 2차 익절가 (도달 시 잔량 전량 매도)
  tp1_done?: boolean;          // 1차 익절 체결 여부
  time_horizon?: string;       // 보유 예정 기간 (예: '2-4주')
  planned_exit?: string;       // 매도 계획/조건 메모
  rationale?: string;          // 매수/보유 근거

  updated_at: string;
}

const POSITIONS_FILE = 'positions';

/**
 * 전체 포지션 조회
 */
export async function getPositions(): Promise<Position[]> {
  return db.read<Position>(POSITIONS_FILE);
}

/**
 * 현재 보유(OPEN) 포지션만 조회
 */
export async function getOpenPositions(): Promise<Position[]> {
  const positions = await getPositions();
  return positions.filter(p => p.status === 'OPEN');
}

/**
 * 포지션 저장 (전체 덮어쓰기)
 */
async function savePositions(positions: Position[]): Promise<void> {
  await db.write(POSITIONS_FILE, positions);
}

/**
 * 단일 포지션 부분 갱신
 * - SL/TP 감시자가 체결 상태(tp1_done 등)를 기록할 때 사용
 * @param symbol 대상 심볼
 * @param patch  갱신할 필드들
 * @returns 갱신된 포지션 (없으면 null)
 */
export async function updatePosition(symbol: string, patch: Partial<Position>): Promise<Position | null> {
  // 파일 락: watcher(tp1_done 기록)와 reconcile이 겹칠 때 갱신 유실 방지
  return db.withLock(POSITIONS_FILE, async () => {
    const positions = await getPositions();
    const idx = positions.findIndex(p => p.symbol === symbol);
    if (idx < 0) return null;

    positions[idx] = {
      ...positions[idx],
      ...patch,
      symbol: positions[idx].symbol, // 심볼은 변경 불가
      updated_at: new Date().toISOString()
    };
    await savePositions(positions);
    return positions[idx];
  });
}

/**
 * trades.json에서 해당 심볼의 최초 매수 시각 유도
 * @param symbol 종목 심볼
 * @returns 최초 BUY의 traded_at (없으면 현재 시각)
 */
async function deriveOpenedAt(symbol: string): Promise<string> {
  // 현재 보유 사이클의 진입 시각 = 마지막 전량 매도(잔량 0) 이후 첫 BUY.
  // 재진입 종목에서 과거 사이클의 최초 매수일을 반환하지 않도록 잔량을 재생하며 추적한다.
  const trades = await db.find<Trade>('trades', t => t.symbol === symbol);
  if (trades.length === 0) return new Date().toISOString();

  trades.sort((a, b) => new Date(a.traded_at).getTime() - new Date(b.traded_at).getTime());

  let shares = 0;
  let cycleStart: string | null = null;
  for (const t of trades) {
    if (t.side === 'BUY') {
      if (shares < 0.0001) cycleStart = t.traded_at; // 잔량 0에서의 매수 = 새 사이클 시작
      shares += t.qty;
    } else {
      shares -= t.qty;
      if (shares < 0.0001) cycleStart = null; // 전량 매도 → 사이클 종료
    }
  }

  return cycleStart ?? new Date().toISOString();
}

/**
 * 토스 보유종목(진실)과 positions.json(의도) 동기화
 *
 * - 토스에 있는 종목: shares/avg_cost를 토스 값으로 갱신(OPEN). 신규면 포지션 생성.
 * - 토스에 없는데 앱엔 OPEN인 종목: 청산된 것으로 보고 CLOSED 처리.
 * - SL/TP/horizon/근거 등 계획 정보는 보존한다.
 * @returns 동기화된 전체 포지션
 */
export async function reconcileWithToss(): Promise<Position[]> {
  const holdings: Holding[] = await getHoldings(); // 토스 실계좌 전용 (폴백 없음, 실패 시 throw)
  // 파일 락: 토스 조회(네트워크)는 락 밖에서, positions 읽기-병합-쓰기만 임계 구역으로
  return db.withLock(POSITIONS_FILE, async () => {
  const existing = await getPositions();
  const bySymbol = new Map(existing.map(p => [p.symbol, p]));
  const now = new Date().toISOString();

  // 1. 토스 보유종목 → 포지션 upsert
  for (const h of holdings) {
    const prev = bySymbol.get(h.symbol);
    if (prev) {
      // 재진입: CLOSED였던 종목을 다시 보유하게 된 경우, 이전 사이클의
      // 매매 계획(SL/TP/tp1_done/근거)을 반드시 초기화한다 — 낡은 손절가가
      // 남아 있으면 재진입 직후 감시자가 즉시 매도해버릴 수 있다.
      if (prev.status === 'CLOSED') {
        delete prev.stop_loss;
        delete prev.take_profit_1;
        delete prev.take_profit_2;
        delete prev.tp1_done;
        delete prev.time_horizon;
        delete prev.planned_exit;
        delete prev.rationale;
        delete prev.source_report_id;
        prev.opened_at = await deriveOpenedAt(h.symbol);
      }
      prev.shares = h.shares;
      prev.avg_cost = h.avg_cost;
      prev.currency = h.currency;
      prev.status = 'OPEN';
      prev.updated_at = now;
    } else {
      bySymbol.set(h.symbol, {
        symbol: h.symbol,
        status: 'OPEN',
        shares: h.shares,
        avg_cost: h.avg_cost,
        currency: h.currency,
        opened_at: await deriveOpenedAt(h.symbol),
        updated_at: now
      });
    }
  }

  // 2. 토스에 없는데 OPEN인 포지션 → 청산 처리
  const heldSymbols = new Set(holdings.map(h => h.symbol));
  for (const p of bySymbol.values()) {
    if (p.status === 'OPEN' && !heldSymbols.has(p.symbol)) {
      p.status = 'CLOSED';
      p.shares = 0;
      p.updated_at = now;
    }
  }

  const merged = Array.from(bySymbol.values());
  await savePositions(merged);
  console.log(`🔄 포지션 동기화 완료: OPEN ${merged.filter(p => p.status === 'OPEN').length}개`);
  return merged;
  }); // withLock 종료
}

/**
 * Manager 결정의 SL/TP/보유계획/근거를 현재 보유 포지션에 반영
 *
 * - BUY/HOLD 결정: 해당 심볼을 보유 중이면 SL/TP/horizon/근거를 갱신한다.
 * - 신규 매수(아직 미보유)는 결정(decisions.json)에만 남고, 체결(Phase 3) 후 포지션이 된다.
 * @param decision Manager 구조화 결정
 * @returns 갱신된 전체 포지션
 */
export async function applyDecisionToPositions(decision: ManagerDecision): Promise<Position[]> {
  // 파일 락: watcher의 tp1_done 기록과 겹칠 때 유실 방지
  return db.withLock(POSITIONS_FILE, async () => {
    const positions = await getPositions();
    const bySymbol = new Map(positions.map(p => [p.symbol, p]));
    const now = new Date().toISOString();

    for (const action of decision.actions) {
      if (action.action === 'SELL') continue; // 매도 계획은 실행기(Phase 3)에서 처리
      const p = bySymbol.get(action.symbol);
      if (!p || p.status !== 'OPEN') continue; // 미보유 신규매수는 decisions.json에만 기록

      if (action.stop_loss !== undefined) p.stop_loss = action.stop_loss;
      if (action.take_profit_1 !== undefined) p.take_profit_1 = action.take_profit_1;
      if (action.take_profit_2 !== undefined) p.take_profit_2 = action.take_profit_2;
      if (action.time_horizon) p.time_horizon = action.time_horizon;
      if (action.rationale) p.rationale = action.rationale;
      p.source_report_id = decision.report_id;
      p.updated_at = now;
    }

    const merged = Array.from(bySymbol.values());
    await savePositions(merged);
    console.log(`📝 결정 반영 완료: ${decision.actions.length}개 액션 → 보유 포지션 계획 갱신`);
    return merged;
  });
}
