import { ManagerDecision, DecisionItem } from './decision';
import { executeBuy, executeSell, TradeResult } from './trading';
import { isUsRegularSessionOpen, getSellableQuantity } from './toss';

/**
 * Manager 결정 집행기 (Phase 3)
 *
 * - Manager의 구조화 결정(BUY/SELL/HOLD)을 실제 토스 주문으로 변환한다.
 * - 정규장 전용: 장이 열릴 때까지 대기 후 집행 (프리/애프터마켓 주문 금지는
 *   trading.executeOrder의 세션 가드가 이중으로 보장).
 * - 모든 주문은 trading.ts 가드레일(종목당 한도, 24h 누적 한도, 잔고/보유 검증,
 *   dry-run 게이트)을 그대로 통과한다.
 */

/** 결정 집행 결과 요약 */
export interface ExecutionSummary {
  executed: TradeResult[];   // 주문 성공 (dry-run 포함)
  failed: TradeResult[];     // 가드레일 거부/오류
  skipped: string[];         // HOLD 등 집행 대상 아님
}

/**
 * 정규장이 열릴 때까지 대기
 * @param maxWaitMinutes 최대 대기 시간(분) — 초과 시 false 반환
 * @returns 정규장이 열렸으면 true
 */
export async function waitForRegularSession(maxWaitMinutes: number = 90): Promise<boolean> {
  const deadline = Date.now() + maxWaitMinutes * 60 * 1000;

  while (Date.now() < deadline) {
    if (await isUsRegularSessionOpen()) return true;
    console.log('⏳ 미국 정규장 개장 대기 중... (30초 후 재확인)');
    await new Promise(r => setTimeout(r, 30 * 1000));
  }
  return false;
}

/**
 * BUY 결정 1건 집행
 * - amount(금액 주문, 소수점 매수) 우선, 없으면 qty 사용
 */
async function executeBuyDecision(item: DecisionItem): Promise<TradeResult> {
  return executeBuy({
    symbol: item.symbol,
    qty: item.amount === undefined ? item.qty : undefined,
    amount: item.amount,
    orderType: item.order_type || 'MARKET',
    price: item.order_type === 'LIMIT' ? item.limit_price : undefined,
    note: `Manager 결정 매수${item.rationale ? ` — ${item.rationale.slice(0, 80)}` : ''}`
  });
}

/**
 * SELL 결정 1건 집행
 * - qty 미지정 시 매도 가능 수량 전량
 */
async function executeSellDecision(item: DecisionItem): Promise<TradeResult> {
  let qty = item.qty;
  if (qty === undefined) {
    qty = await getSellableQuantity(item.symbol);
    if (qty <= 0) {
      return {
        success: false, dryRun: false, symbol: item.symbol, side: 'SELL',
        error: '매도 가능 수량이 없습니다 (보유 없음 또는 전량 주문 중).'
      };
    }
  }

  return executeSell({
    symbol: item.symbol,
    qty,
    orderType: item.order_type || 'MARKET',
    price: item.order_type === 'LIMIT' ? item.limit_price : undefined,
    note: `Manager 결정 매도${item.rationale ? ` — ${item.rationale.slice(0, 80)}` : ''}`
  });
}

/**
 * Manager 결정 전체 집행
 * - SELL을 먼저 집행해 현금을 확보한 뒤 BUY를 집행한다.
 * - 개별 주문 실패는 기록만 하고 다음 주문을 계속한다.
 * @param decision Manager 결정
 * @returns 집행 요약
 */
export async function executeDecision(decision: ManagerDecision): Promise<ExecutionSummary> {
  const summary: ExecutionSummary = { executed: [], failed: [], skipped: [] };

  const sells = decision.actions.filter(a => a.action === 'SELL');
  const buys = decision.actions.filter(a => a.action === 'BUY');
  const holds = decision.actions.filter(a => a.action === 'HOLD');
  summary.skipped = holds.map(h => `${h.symbol} (HOLD)`);

  console.log(`🎯 결정 집행 시작: SELL ${sells.length} → BUY ${buys.length} (HOLD ${holds.length} 건너뜀)`);

  // 매도 먼저 (현금 확보 후 매수)
  for (const item of [...sells, ...buys]) {
    try {
      const result = item.action === 'SELL'
        ? await executeSellDecision(item)
        : await executeBuyDecision(item);

      if (result.success) {
        summary.executed.push(result);
        console.log(`✅ ${item.action} ${item.symbol} ${result.dryRun ? '[DRY-RUN]' : `주문번호 ${result.orderId}`}`);
      } else {
        summary.failed.push(result);
        console.warn(`⚠️ ${item.action} ${item.symbol} 거부: ${result.error}`);
      }
    } catch (error: any) {
      summary.failed.push({
        success: false, dryRun: false, symbol: item.symbol, side: item.action as 'BUY' | 'SELL',
        error: error.message
      });
      console.error(`❌ ${item.action} ${item.symbol} 오류:`, error.message);
    }

    // 주문 간 짧은 간격 (레이트리밋 여유)
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`🎯 결정 집행 완료: 성공 ${summary.executed.length} / 거부·실패 ${summary.failed.length} / 건너뜀 ${summary.skipped.length}`);
  return summary;
}
