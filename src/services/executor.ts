import { ManagerDecision, DecisionItem, ExecutionOutcome } from './decision';
import { executeBuy, executeSell, TradeResult, getMaxOrderUsd, getRemainingDailyBuyUsd } from './trading';
import { isUsRegularSessionOpen, getSellableQuantity, getPrices, getActiveRegularSession } from './toss';
import {
  PendingEntry, isEntryTriggerEnabled, getPreviousClose, resolveTrigger, shouldFireEntry,
  addPendingEntry, getPendingEntries, removePendingEntry, updatePendingOutcome
} from './entryTrigger';

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
  pending: PendingEntry[];   // 조건부 진입 대기 (현재가 > 전일 종가)
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
export async function executeBuyDecision(item: DecisionItem): Promise<TradeResult> {
  // 금액(amount) 주문은 토스 스펙상 MARKET 전용 — LLM이 LIMIT+amount 조합을 내면
  // 주문을 거부(기회 상실)하는 대신 금액 의도를 우선해 MARKET으로 보정한다
  // 소수점 수량 매수는 토스 미지원(매도 전용) — 거부하지 말고 금액 주문으로 환산한다.
  // executor는 이미 같은 철학의 보정을 두 방향으로 하고 있는데(LIMIT+amount→MARKET,
  // amount 거부→정수 qty) 이 방향만 비어 있어 매수가 통째로 유실됐다.
  // (2026-08-31 실측: ZETA qty 3.9 · MRNA qty 0.67 두 건 전량 거부 → 그날 매매 0건)
  if (item.amount === undefined && item.qty !== undefined && !Number.isInteger(item.qty)) {
    const ref = item.limit_price ?? (await getPrices([item.symbol]))[item.symbol];
    if (ref && ref > 0) {
      const converted = Math.round(item.qty * ref * 100) / 100;
      console.warn(`⚠️ ${item.symbol}: 소수점 수량 ${item.qty}주는 매수 미지원 — $${converted} 금액 주문으로 환산 (기준가 $${ref})`);
      item = { ...item, amount: converted, qty: undefined };
    } else {
      return {
        success: false, dryRun: false, symbol: item.symbol, side: 'BUY',
        error: `소수점 수량 ${item.qty}주 매수는 금액 주문으로 환산해야 하나 기준가 조회에 실패했습니다.`
      };
    }
  }

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

  // 일일 누적 한도 클램프: 종목당 한도와 같은 원리로, 남은 여력을 넘으면 거부 대신 축소한다.
  // (2026-08-14 CRDO: $150·$295 두 번 요청 → 두 번 다 전량 거부. 남은 여력 $133로 줄였으면
  //  체결됐다. 게다가 거부는 execution_outcomes에 안 남아 Manager가 학습도 못 했다)
  // 한도 자체는 그대로이며, executeOrder의 최후 검사도 유지된다 — 여기선 사전 축소만 한다.
  const remainingDaily = await getRemainingDailyBuyUsd();
  const MIN_ORDER_USD = 5; // 남은 여력이 이보다 작으면 의미 있는 주문이 안 된다
  if (remainingDaily < MIN_ORDER_USD) {
    return {
      success: false, dryRun: false, symbol: item.symbol, side: 'BUY',
      error: `일일 매수 한도 소진 — 남은 여력 $${remainingDaily.toFixed(2)} (최소 주문 $${MIN_ORDER_USD} 미만).`
    };
  }
  if (amount !== undefined && amount > remainingDaily) {
    console.warn(`⚠️ ${item.symbol}: 결정 금액 $${amount} > 일일 잔여 한도 $${remainingDaily.toFixed(2)} — 잔여 한도로 축소`);
    amount = Math.floor(remainingDaily * 100) / 100; // 부동소수 오차로 한도를 넘지 않도록 내림
  }
  if (qty !== undefined) {
    const refPrice = item.limit_price ?? (await getPrices([item.symbol]))[item.symbol];
    if (refPrice && qty * refPrice > remainingDaily) {
      const clamped = Math.floor(remainingDaily / refPrice);
      if (clamped < 1) {
        return {
          success: false, dryRun: false, symbol: item.symbol, side: 'BUY',
          error: `1주 가격 $${refPrice.toFixed(2)}이 일일 잔여 한도 $${remainingDaily.toFixed(2)}를 초과해 매수 불가.`
        };
      }
      console.warn(`⚠️ ${item.symbol}: ${qty}주×$${refPrice.toFixed(2)} > 일일 잔여 $${remainingDaily.toFixed(2)} — ${clamped}주로 축소`);
      qty = clamped;
    }
  }

  const result = await executeBuy({
    symbol: item.symbol,
    qty,
    amount,
    orderType,
    price: orderType === 'LIMIT' ? item.limit_price : undefined,
    note: `Manager 결정 매수${item.rationale ? ` — ${item.rationale.slice(0, 80)}` : ''}`
  });

  // 소수점 거래 제한 종목 폴백: 금액 주문(소수점 체결)이 거부되면
  // 금액에 맞는 정수 수량 시장가 주문으로 전환해 매수 의도를 살린다
  if (!result.success && amount !== undefined && /소수점 거래가 제한|stock-restricted/.test(result.error || '')) {
    const price = (await getPrices([item.symbol]))[item.symbol];
    const intQty = price ? Math.floor(amount / price) : 0;
    if (intQty >= 1) {
      console.warn(`⚠️ ${item.symbol}: 소수점 제한 종목 — $${amount} 금액 주문을 ${intQty}주 정수 주문으로 전환`);
      return executeBuy({
        symbol: item.symbol,
        qty: intQty,
        orderType: 'MARKET',
        note: `Manager 결정 매수 (소수점 제한 → 정수 전환)${item.rationale ? ` — ${item.rationale.slice(0, 60)}` : ''}`
      });
    }
    console.warn(`⚠️ ${item.symbol}: 1주 가격 $${price}가 배분액 $${amount}보다 커서 정수 전환 불가`);
    // 거부 사유는 다음 사이클 Manager 입력(집행 결과)에 그대로 실린다. 토스 원문("소수점 거래가
    // 제한된 종목")만으로는 '얼마를 배분해야 살 수 있는지'가 안 보여 같은 주문을 반복한다
    // (2026-10-13 MTSI: 1주 $315에 $70 배분).
    return {
      ...result,
      error: `소수점 거래 제한 종목 — 정수 주만 매수 가능한데 1주 가격 $${price ? price.toFixed(2) : '조회 실패'}가 배분액 $${amount}보다 크다. 1주 가격 이상을 배분할 수 없으면 이 종목은 매수 불가.`
    };
  }

  return result;
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
  // 먼지 잔량 방지: 거의 전량(99% 이상) 매도면 정확히 전량으로 — LLM이 소수점을
  // 반올림해 내면 0.000005주 같은 잔여분이 생겨 토스가 422(잔여분 최소금액 미달)로 거부한다
  if (qty < sellable && qty >= sellable * 0.99) {
    console.warn(`⚠️ ${item.symbol}: 잔여 먼지 방지 — ${qty} → 전량 ${sellable}로 조정`);
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
  const summary: ExecutionSummary = { executed: [], failed: [], skipped: [], pending: [] };

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

  // 3) 매수 — 조건부 진입: 현재가가 전일 종가 이하일 때만 즉시, 아니면 대기 목록으로
  const session = buys.length > 0 && isEntryTriggerEnabled() ? await getActiveRegularSession() : null;
  for (const item of buys) {
    if (session) {
      try {
        const prevClose = await getPreviousClose(item.symbol, session.start);
        const price = (await getPrices([item.symbol]))[item.symbol];
        if (prevClose && price) {
          const trigger = resolveTrigger(item, prevClose);
          if (!shouldFireEntry(price, trigger.price)) {
            const entry: PendingEntry = {
              report_id: decision.report_id,
              item,
              trigger_price: trigger.price,
              trigger_basis: trigger.basis,
              session_start: session.start,
              expires_at: session.end - 60 * 60 * 1000, // 소수점 주문 마감 = 장 마감 1시간 전
              created_at: new Date().toISOString()
            };
            await addPendingEntry(entry);
            summary.pending.push(entry);
            console.log(`⏳ BUY ${item.symbol} 조건부 대기: 현재가 $${price} > 기준 $${trigger.price} (${trigger.basis === 'prev_close' ? '전일 종가' : '지정가'}) — 마감 1시간 전까지 감시`);
            continue;
          }
          console.log(`🎯 BUY ${item.symbol} 진입 조건 충족: 현재가 $${price} ≤ 기준 $${trigger.price} — 즉시 매수`);
        } else {
          // 기준가를 못 구하면 조건을 판정할 수 없다 — 매수를 통째로 잃는 대신 예전 방식(즉시)으로 집행
          console.warn(`⚠️ BUY ${item.symbol} 전일 종가/현재가 조회 실패 — 조건 없이 즉시 집행`);
        }
      } catch (e: any) {
        console.warn(`⚠️ BUY ${item.symbol} 진입 조건 판정 오류 — 조건 없이 즉시 집행:`, e.message);
      }
    }
    await runOne(item);
  }

  console.log(`🎯 결정 집행 완료: 성공 ${summary.executed.length} / 거부·실패 ${summary.failed.length} / 대기 ${summary.pending.length} / 건너뜀 ${summary.skipped.length}`);
  return summary;
}

/**
 * 조건부 진입 대기 목록 1회 처리 (감시기가 정규장 중 매분 호출)
 *
 * - 세션이 바뀌었거나 소수점 마감을 지난 대기 → 만료(EXPIRED)로 결과 기록
 * - 이미 보유 중이거나 동시보유 상한이면 → 만료 (규칙서 12번: 최대 3종)
 * - 현재가 ≤ 기준가 → 결정 금액 그대로 매수 (가드레일은 executeBuyDecision → executeOrder가 그대로 적용)
 * @param session 진행 중인 정규장 세션
 * @param now 기준 시각
 * @param openSymbols 현재 보유 종목 심볼 목록
 * @param maxPositions 동시보유 상한
 * @returns 실주문 체결이 있었던 대기 목록 (호출자가 포지션 동기화에 사용)
 */
export async function processPendingEntries(
  session: { start: number; end: number },
  now: number,
  openSymbols: string[],
  maxPositions: number
): Promise<PendingEntry[]> {
  const all = await getPendingEntries();
  if (all.length === 0) return [];

  const filled: PendingEntry[] = [];
  const expire = async (e: PendingEntry, reason: string) => {
    await removePendingEntry(e.report_id, e.item.symbol);
    await updatePendingOutcome(e.report_id, { symbol: e.item.symbol, action: 'BUY', status: 'EXPIRED', reason }, false);
    console.log(`⌛ BUY ${e.item.symbol} 조건부 진입 만료 — ${reason}`);
  };

  const live: PendingEntry[] = [];
  for (const e of all) {
    if (e.session_start !== session.start || now >= e.expires_at) {
      await expire(e, `마감 1시간 전까지 현재가가 기준 $${e.trigger_price}(${e.trigger_basis === 'prev_close' ? '전일 종가' : '지정가'}) 이하로 오지 않아 미체결`);
    } else if (openSymbols.includes(e.item.symbol)) {
      await expire(e, '이미 보유 중인 종목');
    } else {
      live.push(e);
    }
  }
  if (live.length === 0) return [];

  const prices = await getPrices(live.map(e => e.item.symbol));
  let held = openSymbols.length;
  for (const e of live) {
    const price = prices[e.item.symbol];
    if (!price || !shouldFireEntry(price, e.trigger_price)) continue;
    if (held >= maxPositions) {
      await expire(e, `동시보유 상한 ${maxPositions}종 도달`);
      continue;
    }

    console.log(`🎯 BUY ${e.item.symbol} 조건 도달: 현재가 $${price} ≤ 기준 $${e.trigger_price} — 매수 집행`);
    // 목록에서 먼저 빼서 다음 틱의 이중 매수를 막는다 (주문 결과와 무관하게 이 대기는 소진)
    await removePendingEntry(e.report_id, e.item.symbol);
    let result: TradeResult;
    try {
      result = await executeBuyDecision(e.item);
    } catch (err: any) {
      result = { success: false, dryRun: false, symbol: e.item.symbol, side: 'BUY', error: err.message };
    }
    if (result.success) {
      console.log(`✅ BUY ${e.item.symbol} ${result.dryRun ? '[DRY-RUN]' : `주문번호 ${result.orderId}`} (조건부 진입)`);
      await updatePendingOutcome(e.report_id, {
        symbol: e.item.symbol, action: 'BUY', status: 'FILLED',
        filled_qty: result.qty, filled_price: result.price ?? result.estimatedNotional
      }, !result.dryRun);
      if (!result.dryRun) { filled.push(e); held++; }
    } else {
      console.warn(`⚠️ BUY ${e.item.symbol} 조건부 진입 거부: ${result.error}`);
      await updatePendingOutcome(e.report_id, { symbol: e.item.symbol, action: 'BUY', status: 'REJECTED', reason: result.error }, false);
    }
  }
  return filled;
}

/**
 * 집행 요약 → Manager 피드백용 결과 목록으로 변환
 * - 다음 사이클에 "지난 지시가 실제로 어떻게 됐나"를 Manager에게 알려주기 위함
 * @param decision 원본 결정
 * @param summary  집행 요약
 * @returns 종목별 집행 결과 (FILLED/REJECTED/SKIPPED)
 */
export function buildExecutionOutcomes(
  decision: ManagerDecision,
  summary: ExecutionSummary
): ExecutionOutcome[] {
  const outcomes: ExecutionOutcome[] = [];

  for (const r of summary.executed) {
    outcomes.push({
      symbol: r.symbol, action: r.side as any, status: 'FILLED',
      filled_qty: r.qty, filled_price: r.price ?? r.estimatedNotional
    });
  }
  for (const r of summary.failed) {
    outcomes.push({ symbol: r.symbol, action: r.side as any, status: 'REJECTED', reason: r.error });
  }
  for (const e of summary.pending) {
    outcomes.push({
      symbol: e.item.symbol, action: 'BUY', status: 'PENDING',
      reason: `조건부 진입 대기: 기준 $${e.trigger_price}(${e.trigger_basis === 'prev_close' ? '전일 종가' : '지정가'}) 이하 도달 시 매수, 마감 1시간 전 만료`
    });
  }
  // HOLD 등 집행 대상 아님 (summary.skipped는 "SYMBOL (HOLD)" 문자열)
  for (const s of summary.skipped) {
    const sym = s.replace(/\s*\(HOLD\)\s*$/, '');
    outcomes.push({ symbol: sym, action: 'HOLD', status: 'SKIPPED' });
  }
  return outcomes;
}
