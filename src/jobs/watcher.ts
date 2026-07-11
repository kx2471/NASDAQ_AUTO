import { getOpenPositions, updatePosition, reconcileWithToss, Position } from '../storage/positions';
import { getPrices, isUsRegularSessionOpen, getSellableQuantity } from '../services/toss';
import { executeSell } from '../services/trading';

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
    const half = Math.floor(position.shares / 2);
    return {
      type: 'TP1',
      qty: half >= 1 ? half : position.shares,
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
        console.warn(`⚠️ ${position.symbol} 매도 가능 수량 없음 — 건너뜀`);
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
