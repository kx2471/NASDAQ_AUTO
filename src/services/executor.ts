import { ManagerDecision, DecisionItem } from './decision';
import { executeBuy, executeSell, TradeResult, getMaxOrderUsd } from './trading';
import { isUsRegularSessionOpen, getSellableQuantity, getPrices } from './toss';

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
  // 금액(amount) 주문은 토스 스펙상 MARKET 전용 — LLM이 LIMIT+amount 조합을 내면
  // 주문을 거부(기회 상실)하는 대신 금액 의도를 우선해 MARKET으로 보정한다
  const useAmount = item.amount !== undefined;
  const orderType = useAmount ? 'MARKET' : (item.order_type || 'MARKET');
  if (useAmount && item.order_type === 'LIMIT') {
    console.warn(`⚠️ ${item.symbol}: LIMIT+금액 주문은 토스 미지원 — MARKET 금액 주문으로 보정`);
  }

  // 종목당 한도 클램프: Manager 배분이 한도를 넘으면 거부(기회 상실) 대신
  // 한도에 맞게 수량/금액을 줄여 매수 의도를 살린다 (SELL 클램프와 같은 원리)
  const maxOrder = getMaxOrderUsd();
  let qty = useAmount ? undefined : item.qty;
  let amount = item.amount;

  if (amount !== undefined && amount > maxOrder) {
    console.warn(`⚠️ ${item.symbol}: 결정 금액 $${amount} > 한도 $${maxOrder} — 한도로 축소`);
    amount = maxOrder;
  }
  if (qty !== undefined) {
    const refPrice = item.limit_price ?? (await getPrices([item.symbol]))[item.symbol];
    if (refPrice && qty * refPrice > maxOrder) {
      const clamped = Math.floor(maxOrder / refPrice);
      if (clamped < 1) {
        return {
          success: false, dryRun: false, symbol: item.symbol, side: 'BUY',
          error: `1주 가격 $${refPrice.toFixed(2)}이 종목당 한도 $${maxOrder}를 초과해 매수 불가.`
        };
      }
      console.warn(`⚠️ ${item.symbol}: ${qty}주×$${refPrice.toFixed(2)}=$${(qty * refPrice).toFixed(2)} > 한도 $${maxOrder} — ${clamped}주로 축소`);
      qty = clamped;
    }
  }

  return executeBuy({
    symbol: item.symbol,
    qty,
    amount,
    orderType,
    price: orderType === 'LIMIT' ? item.limit_price : undefined,
    note: `Manager 결정 매수${item.rationale ? ` — ${item.rationale.slice(0, 80)}` : ''}`
  });
}

/**
 * SELL 결정 1건 집행
 * - qty 미지정 시 매도 가능 수량 전량
 */
async function executeSellDecision(item: DecisionItem): Promise<TradeResult> {
  const sellable = await getSellableQuantity(item.symbol);
  if (sellable <= 0) {
    return {
      success: false, dryRun: false, symbol: item.symbol, side: 'SELL',
      error: '매도 가능 수량이 없습니다 (보유 없음 또는 전량 주문 중).'
    };
  }

  // Manager가 수량을 지정했으면 매도가능수량으로 클램프 — LLM이 보유량을
  // 과대 추정해도 매도 의도 자체(청산)는 살린다. 미지정이면 전량.
  let qty = item.qty ?? sellable;
  if (qty > sellable) {
    console.warn(`⚠️ ${item.symbol}: 결정 수량 ${qty} > 매도가능 ${sellable} — 가능 수량으로 조정`);
    qty = sellable;
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

  /** 주문 1건 처리 (성공/실패 요약 기록) */
  const runOne = async (item: DecisionItem): Promise<TradeResult | null> => {
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
      return result;
    } catch (error: any) {
      summary.failed.push({
        success: false, dryRun: false, symbol: item.symbol, side: item.action as 'BUY' | 'SELL',
        error: error.message
      });
      console.error(`❌ ${item.action} ${item.symbol} 오류:`, error.message);
      return null;
    } finally {
      // 주문 간 짧은 간격 (레이트리밋 여유)
      await new Promise(r => setTimeout(r, 1500));
    }
  };

  // 1) 매도 먼저 (현금 확보)
  let realSellHappened = false;
  for (const item of sells) {
    const r = await runOne(item);
    if (r?.success && !r.dryRun) realSellHappened = true;
  }

  // 2) 실매도가 있었으면 매도 대금이 매수가능금액에 반영될 시간을 준다
  //    (시장가라도 체결·잔고 반영이 즉시가 아닐 수 있음 — 바로 사면 잔고 부족 거부)
  if (realSellHappened && buys.length > 0) {
    console.log('⏳ 매도 대금 반영 대기 (15초)...');
    await new Promise(r => setTimeout(r, 15 * 1000));
  }

  // 3) 매수
  for (const item of buys) {
    await runOne(item);
  }

  console.log(`🎯 결정 집행 완료: 성공 ${summary.executed.length} / 거부·실패 ${summary.failed.length} / 건너뜀 ${summary.skipped.length}`);
  return summary;
}
