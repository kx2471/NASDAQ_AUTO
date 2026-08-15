import { db, Trade } from '../storage/database';
import {
  createOrder,
  getPrices,
  getBuyingPower,
  getSellableQuantity,
  isDryRun,
  isTossEnabled,
  isUsRegularSessionOpen,
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
export function getMaxOrderUsd(): number {
  return parseFloat(process.env.TOSS_MAX_ORDER_USD || '') || 1000;
}

/**
 * 24시간 누적 매수 총액(USD) 한도 조회
 * - TOSS_MAX_DAILY_BUY_USD 미설정 시 기본값 2000 USD
 * - 버그·환각으로 소액 주문이 연쇄 집행되는 것을 막는 집계 가드레일
 */
function getMaxDailyBuyUsd(): number {
  return parseFloat(process.env.TOSS_MAX_DAILY_BUY_USD || '') || 2000;
}

/**
 * 이번 세션에 남은 매수 여력(USD) 조회 — 집행기의 사전 클램프용.
 *
 * 한도 자체는 바꾸지 않는다. executeOrder의 최후 검사는 그대로 유지되고,
 * 이 값은 "거부당할 금액으로 주문을 보내지 않기 위해" 미리 줄이는 데만 쓴다.
 * (2026-08-14: CRDO를 $150·$295로 두 번 요청해 두 번 다 거부됐다. 남은 여력
 *  $133로 줄였으면 체결됐을 건이다 — 종목당 한도에는 이미 같은 클램프가 있다)
 * @returns 남은 매수 가능 금액(USD, 0 이상)
 */
export async function getRemainingDailyBuyUsd(sessionStart?: number): Promise<number> {
  const spent = await getRecentBuyNotional(sessionStart);
  return Math.max(0, getMaxDailyBuyUsd() - spent);
}

/**
 * LIMIT 가격이 현재가에서 벗어날 수 있는 최대 비율(%) 조회
 * - TOSS_MAX_PRICE_DEVIATION_PCT 미설정 시 기본값 20%
 * - LLM이 환각으로 엉뚱한 지정가를 내는 것을 차단
 */
function getMaxPriceDeviationPct(): number {
  return parseFloat(process.env.TOSS_MAX_PRICE_DEVIATION_PCT || '') || 20;
}

/**
 * 미국 티커 형식 검증
 * - 이 시스템은 미국 주식 전용. KRX 심볼(6자리 숫자)과 비정상 문자열을 거부한다.
 * @param symbol 종목 심볼
 */
function isUsTicker(symbol: string): boolean {
  if (/^\d{6}$/.test(symbol)) return false; // KRX 심볼 (예: 005930)
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol);
}

/**
 * 최근 24시간 실집행 매수 총액(USD) 계산 (trades.json 기준)
 * - dry-run 주문은 기록되지 않으므로 한도를 소모하지 않는다.
 */
async function getRecentBuyNotional(cutoffOverride?: number): Promise<number> {
  if (cutoffOverride !== undefined) {
    const trades = await db.find<Trade>('trades', t =>
      t.side === 'BUY' && new Date(t.traded_at).getTime() >= cutoffOverride
    );
    return trades.reduce((sum, t) => sum + t.qty * t.price, 0);
  }
  // "일일" 한도의 창은 오늘 정규장 세션 시작부터 — 롤링 24시간을 쓰면
  // 전일 매수가 창에 남아 당일 매도 대금 재투자까지 막는다 (2026-07-14 실사고).
  // 캘린더 조회 실패 시에만 보수적으로 24시간 롤링으로 폴백.
  // ⚠️ today.regular.start를 직접 쓰면 안 된다 — 토스 `today`는 한국 날짜 기준이라
  // 자정 이후엔 시작 시각이 미래가 되고, cutoff가 미래면 매칭 매수가 0건이 되어
  // 일일 한도가 매일 자정에 리셋되는 구멍이 생긴다 (2026-07-30 발견).
  // 이미 시작된 세션 중 최근 것을 기준으로 삼는다.
  let cutoff: number;
  try {
    const { getLatestSessionStart } = await import('./toss');
    const sessionStart = await getLatestSessionStart();
    cutoff = sessionStart ?? Date.now() - 24 * 60 * 60 * 1000;
  } catch {
    cutoff = Date.now() - 24 * 60 * 60 * 1000;
  }

  const trades = await db.find<Trade>('trades', t =>
    t.side === 'BUY' && new Date(t.traded_at).getTime() >= cutoff
  );
  return trades.reduce((sum, t) => sum + t.qty * t.price, 0);
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
    order.symbol = order.symbol.toUpperCase();

    // 1. 입력 검증
    if (!isUsTicker(order.symbol)) {
      return fail(order, `${order.symbol}은(는) 미국 티커가 아닙니다 (이 시스템은 미국 주식 전용, KRX 심볼 거부).`);
    }
    if (order.qty === undefined && order.amount === undefined) {
      return fail(order, 'qty 또는 amount 중 하나는 필수입니다.');
    }
    // 토스 스펙: quantity와 orderAmount는 정확히 하나만 (동시 지정 시 400)
    if (order.qty !== undefined && order.amount !== undefined) {
      return fail(order, 'qty와 amount는 동시에 지정할 수 없습니다 (토스 스펙: 정확히 하나만).');
    }
    if (order.qty !== undefined && order.qty <= 0) {
      return fail(order, '수량은 0보다 커야 합니다.');
    }
    if (order.amount !== undefined && order.amount <= 0) {
      return fail(order, '금액은 0보다 커야 합니다.');
    }
    // 토스 스펙: 금액(orderAmount) 주문은 US MARKET 전용 — LIMIT과 조합 시 400
    if (order.amount !== undefined && orderType !== 'MARKET') {
      return fail(order, '금액(amount) 주문은 MARKET 전용입니다 (토스 스펙: LIMIT 불가).');
    }
    // 토스 스펙: 소수점 수량은 미국 주식 MARKET 매도에만 허용 (그 외 정수만)
    if (order.qty !== undefined && !Number.isInteger(order.qty)) {
      if (!(order.side === 'SELL' && orderType === 'MARKET')) {
        return fail(order, `소수점 수량(${order.qty})은 시장가 매도에만 허용됩니다. 매수는 amount(금액) 주문을 사용하세요.`);
      }
      // 소수점 6자리 초과 시 400 — 미리 절사
      order.qty = Math.floor(order.qty * 1e6) / 1e6;
    }
    if (orderType === 'LIMIT' && (order.price === undefined || order.price <= 0)) {
      return fail(order, 'LIMIT 주문은 price가 필요합니다.');
    }

    // 1-1. 정규장 전용 정책: 프리마켓/애프터마켓/휴장 시간에는 주문 금지
    //      (TOSS_ENFORCE_REGULAR_SESSION=false로만 해제 가능 — 테스트용)
    if (process.env.TOSS_ENFORCE_REGULAR_SESSION !== 'false') {
      const sessionOpen = await isUsRegularSessionOpen();
      if (!sessionOpen) {
        return fail(order, '미국 정규장 시간이 아닙니다 — 정규장(KST 22:30~05:00 무렵)에만 주문합니다.');
      }
    }

    // 2. 현재가 조회 (주문 금액 추정 + 지정가 괴리 검증 + 감사 기록에 사용)
    const priceMap = await getPrices([order.symbol]);
    const lastPrice: number | undefined = priceMap[order.symbol];

    // 2-1. 가드레일: LIMIT 가격이 현재가에서 과도하게 벗어나면 거부 (LLM 환각 가격 차단)
    if (orderType === 'LIMIT' && order.price !== undefined) {
      if (lastPrice === undefined) {
        return fail(order, `${order.symbol} 현재가를 조회할 수 없어 지정가 검증이 불가합니다.`);
      }
      const deviationPct = Math.abs(order.price - lastPrice) / lastPrice * 100;
      const maxDeviation = getMaxPriceDeviationPct();
      if (deviationPct > maxDeviation) {
        return fail(order, `지정가 $${order.price}이 현재가 $${lastPrice}에서 ${deviationPct.toFixed(1)}% 벗어남 (허용 ${maxDeviation}%).`);
      }
    }

    // 2-2. 추정 주문 금액 계산 (가드레일용)
    let estimatedNotional: number;
    if (order.amount !== undefined) {
      estimatedNotional = order.amount;
    } else if (order.price !== undefined) {
      estimatedNotional = order.qty! * order.price;
    } else {
      // 시장가 + 수량 → 현재가로 추정
      if (lastPrice === undefined) {
        return fail(order, `${order.symbol} 현재가를 조회할 수 없어 주문 금액을 추정할 수 없습니다.`);
      }
      estimatedNotional = order.qty! * lastPrice;
    }

    // 3. 가드레일: 종목당 최대 주문 금액
    const maxOrderUsd = getMaxOrderUsd();
    if (estimatedNotional > maxOrderUsd) {
      return fail(order, `주문 금액 $${estimatedNotional.toFixed(2)}이 한도 $${maxOrderUsd}를 초과합니다.`);
    }

    // 4. 가드레일: 매수 가능 금액 / 24시간 누적 매수 한도 / 매도 가능 수량
    if (order.side === 'BUY') {
      const buyingPower = await getBuyingPower('USD');
      if (estimatedNotional > buyingPower) {
        return fail(order, `매수 금액 $${estimatedNotional.toFixed(2)}이 매수가능금액 $${buyingPower.toFixed(2)}을 초과합니다.`);
      }
      const recentBuys = await getRecentBuyNotional();
      const maxDaily = getMaxDailyBuyUsd();
      if (recentBuys + estimatedNotional > maxDaily) {
        return fail(order, `당일 누적 매수 $${(recentBuys + estimatedNotional).toFixed(2)}이 한도 $${maxDaily}를 초과합니다 (기집행 $${recentBuys.toFixed(2)}).`);
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

    // 6. 실제 접수된 주문만 감사 기록 (dry-run은 기록하지 않음)
    //  - LIMIT: 지정가로 기록 / MARKET·금액기반: 현재가 기반 추정치로 기록
    //  - 실제 체결가·수량은 토스 주문내역(/orders)이 정답이며, 여기는 감사용 근사치
    if (!result.dryRun) {
      const auditPrice = order.price ?? lastPrice;
      const auditQty = order.qty ?? (auditPrice ? (order.amount! / auditPrice) : undefined);
      if (auditPrice !== undefined && auditQty !== undefined) {
        const isEstimate = order.price === undefined || order.qty === undefined;
        const trade: Omit<Trade, 'id'> = {
          traded_at: new Date().toISOString(),
          symbol: order.symbol,
          side: order.side,
          qty: auditQty,
          price: auditPrice,
          fee: 0,
          note: `${order.note || '자동매매'} (${result.orderId})${isEstimate ? ' [추정가 기록 — 실체결은 토스 주문내역 참조]' : ''}`
        };
        await db.insert('trades', trade);
      } else {
        console.warn(`⚠️ ${order.symbol} 감사 기록 생략 — 가격/수량 추정 불가 (orderId=${result.orderId}). 토스 주문내역으로 확인 필요.`);
      }
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
