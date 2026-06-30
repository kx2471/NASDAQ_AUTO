import { db, Trade } from '../storage/database';
import {
  createOrder,
  getPrices,
  getBuyingPower,
  getSellableQuantity,
  isDryRun,
  isTossEnabled,
  OrderType
} from './toss';

/**
 * 자동매매 주문 실행 계층 (토스증권 기반)
 *
 * - 모든 주문은 가드레일(한도/매수가능/매도가능 검증)을 통과해야 한다.
 * - 멱등키(clientOrderId)로 중복 주문을 방지한다.
 * - TOSS_DRY_RUN(기본 true)이면 실제 전송 없이 주문안만 로깅한다.
 *   실거래로 전환하려면 .env에서 TOSS_DRY_RUN=false 로 설정한다.
 * - 실제 체결된 주문만 trades.json에 감사 기록으로 남긴다 (포트폴리오 정답은 토스 실계좌).
 */

/** 매매 주문 입력 */
export interface TradeOrder {
  symbol: string;
  side: 'BUY' | 'SELL';
  qty?: number;          // 수량기반 주문
  amount?: number;       // 금액기반 주문 (소수점 매수, USD)
  orderType?: OrderType; // 기본 'MARKET'
  price?: number;        // orderType이 'LIMIT'일 때 필수
  note?: string;
}

/** 매매 주문 결과 */
export interface TradeResult {
  success: boolean;
  dryRun: boolean;
  orderId?: string;
  clientOrderId?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty?: number;
  amount?: number;
  price?: number;
  estimatedNotional?: number; // 추정 주문 금액 (USD)
  error?: string;
}

/**
 * 종목당 최대 주문 금액(USD) 가드레일 조회
 * - TOSS_MAX_ORDER_USD 미설정 시 기본값 1000 USD
 */
function getMaxOrderUsd(): number {
  return parseFloat(process.env.TOSS_MAX_ORDER_USD || '') || 1000;
}

/**
 * 멱등키 생성 (symbol-side-분단위 시간 버킷)
 * - 같은 분 안의 동일 종목/방향 재요청을 토스가 동일 주문으로 처리 (중복 방지)
 */
function buildClientOrderId(symbol: string, side: 'BUY' | 'SELL'): string {
  const minuteBucket = Math.floor(Date.now() / 60000);
  return `auto-${symbol}-${side}-${minuteBucket}`.slice(0, 36);
}

/**
 * 실패 결과 생성 헬퍼
 */
function fail(order: TradeOrder, error: string): TradeResult {
  return {
    success: false,
    dryRun: isDryRun(),
    symbol: order.symbol,
    side: order.side,
    qty: order.qty,
    amount: order.amount,
    price: order.price,
    error
  };
}

/**
 * 주문 실행 (매수/매도 공통)
 * - 가드레일 검증 → (실거래면) 토스 주문 전송 → 감사 기록
 * @param order 매매 주문
 * @returns 매매 결과
 */
export async function executeOrder(order: TradeOrder): Promise<TradeResult> {
  try {
    if (!isTossEnabled()) {
      return fail(order, '토스 API가 설정되지 않았습니다 (.env TOSS_API_KEY/TOSS_SECRET_KEY).');
    }

    const orderType: OrderType = order.orderType || 'MARKET';

    // 1. 입력 검증
    if (order.qty === undefined && order.amount === undefined) {
      return fail(order, 'qty 또는 amount 중 하나는 필수입니다.');
    }
    if (order.qty !== undefined && order.qty <= 0) {
      return fail(order, '수량은 0보다 커야 합니다.');
    }
    if (order.amount !== undefined && order.amount <= 0) {
      return fail(order, '금액은 0보다 커야 합니다.');
    }
    if (orderType === 'LIMIT' && (order.price === undefined || order.price <= 0)) {
      return fail(order, 'LIMIT 주문은 price가 필요합니다.');
    }

    // 2. 추정 주문 금액 계산 (가드레일용)
    let estimatedNotional: number;
    if (order.amount !== undefined) {
      estimatedNotional = order.amount;
    } else if (order.price !== undefined) {
      estimatedNotional = order.qty! * order.price;
    } else {
      // 시장가 + 수량 → 현재가로 추정
      const priceMap = await getPrices([order.symbol]);
      const last = priceMap[order.symbol];
      if (!last) {
        return fail(order, `${order.symbol} 현재가를 조회할 수 없어 주문 금액을 추정할 수 없습니다.`);
      }
      estimatedNotional = order.qty! * last;
    }

    // 3. 가드레일: 종목당 최대 주문 금액
    const maxOrderUsd = getMaxOrderUsd();
    if (estimatedNotional > maxOrderUsd) {
      return fail(order, `주문 금액 $${estimatedNotional.toFixed(2)}이 한도 $${maxOrderUsd}를 초과합니다.`);
    }

    // 4. 가드레일: 매수 가능 금액 / 매도 가능 수량
    if (order.side === 'BUY') {
      const buyingPower = await getBuyingPower('USD');
      if (estimatedNotional > buyingPower) {
        return fail(order, `매수 금액 $${estimatedNotional.toFixed(2)}이 매수가능금액 $${buyingPower.toFixed(2)}을 초과합니다.`);
      }
    } else {
      // 매도: 수량기반만 검증 (금액기반 매도는 미지원)
      if (order.qty === undefined) {
        return fail(order, '매도는 수량(qty) 기반만 지원합니다.');
      }
      const sellable = await getSellableQuantity(order.symbol);
      if (order.qty > sellable) {
        return fail(order, `매도 수량 ${order.qty}이 매도가능수량 ${sellable}을 초과합니다.`);
      }
    }

    // 5. 주문 전송 (dry-run이면 내부에서 로깅만)
    const clientOrderId = buildClientOrderId(order.symbol, order.side);
    const result = await createOrder({
      symbol: order.symbol,
      side: order.side,
      orderType,
      quantity: order.qty,
      orderAmount: order.amount,
      price: orderType === 'LIMIT' ? order.price : undefined,
      clientOrderId
    });

    // 6. 실제 체결된 주문만 감사 기록 (dry-run은 기록하지 않음)
    if (!result.dryRun && order.qty !== undefined && order.price !== undefined) {
      const trade: Omit<Trade, 'id'> = {
        traded_at: new Date().toISOString(),
        symbol: order.symbol,
        side: order.side,
        qty: order.qty,
        price: order.price,
        fee: 0,
        note: order.note || `자동매매 (${result.orderId})`
      };
      await db.insert('trades', trade);
    }

    const tag = result.dryRun ? '🧪 [DRY-RUN]' : '✅';
    console.log(`${tag} ${order.symbol} ${order.side} 주문 처리 완료 (추정 $${estimatedNotional.toFixed(2)})`);

    return {
      success: true,
      dryRun: result.dryRun,
      orderId: result.orderId,
      clientOrderId: result.clientOrderId ?? clientOrderId,
      symbol: order.symbol,
      side: order.side,
      qty: order.qty,
      amount: order.amount,
      price: order.price,
      estimatedNotional
    };

  } catch (error) {
    console.error('❌ 주문 실행 실패:', error);
    return fail(order, error instanceof Error ? error.message : '알 수 없는 오류');
  }
}

/**
 * 매수 주문 (편의 함수)
 * @param order side를 제외한 매수 주문 정보
 */
export async function executeBuy(order: Omit<TradeOrder, 'side'>): Promise<TradeResult> {
  return executeOrder({ ...order, side: 'BUY' });
}

/**
 * 매도 주문 (편의 함수)
 * @param order side를 제외한 매도 주문 정보
 */
export async function executeSell(order: Omit<TradeOrder, 'side'>): Promise<TradeResult> {
  return executeOrder({ ...order, side: 'SELL' });
}
