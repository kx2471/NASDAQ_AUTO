import axios, { AxiosRequestConfig } from 'axios';

/**
 * 토스증권 Open API 클라이언트 (단일 관문)
 *
 * - 모든 토스증권 호출은 이 파일을 거친다.
 * - OAuth2 액세스 토큰과 계좌 식별키(accountSeq)를 메모리에 캐시한다.
 * - 토스 API는 수량/가격/금액을 모두 "문자열"로 주고받으므로,
 *   숫자 ↔ 문자열 변환을 이 파일 경계에서만 처리한다.
 *
 * 인증 흐름: client_credentials → Bearer 토큰 → 계좌 호출 시 X-Tossinvest-Account 헤더
 */

const TOSS_BASE_URL = 'https://openapi.tossinvest.com';

// =============================================================
// 타입 정의 (외부에서 사용하는 모양은 모두 숫자로 정규화)
// =============================================================

/** 일/분봉 캔들 (숫자 정규화) */
export interface TossCandle {
  date: string;   // 봉 시작 시각 (ISO 8601)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 보유 종목 (숫자 정규화) */
export interface TossHolding {
  symbol: string;
  shares: number;        // 보유 수량
  avg_cost: number;      // 매수 평균가 (거래 통화 기준)
  lastPrice: number;     // 현재가
  currency: string;      // USD / KRW
}

/** 주문 방향 / 호가 유형 / 유효조건 */
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET';
export type TimeInForce = 'DAY' | 'CLS';

/** 주문 생성 요청 (수량기반 또는 금액기반) */
export interface TossOrderRequest {
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity?: number;       // 수량기반 주문
  orderAmount?: number;    // 금액기반 주문 (소수점 매수)
  price?: number;          // LIMIT일 때만
  timeInForce?: TimeInForce;
  clientOrderId?: string;  // 멱등성 키 (≤36자, 10분 유효)
}

/** 주문 생성 결과 */
export interface TossOrderResult {
  orderId: string;
  clientOrderId: string | null;
  dryRun: boolean;         // dry-run으로 처리되어 실제 전송되지 않았는지 여부
}

// =============================================================
// 인증 / 계좌 캐시
// =============================================================

interface TokenCache {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let tokenCache: TokenCache | null = null;
let accountSeqCache: string | null = null;

/**
 * 토스 API 자격증명 확인
 * @returns client_id / client_secret 설정 여부
 */
export function isTossEnabled(): boolean {
  return !!(process.env.TOSS_API_KEY && process.env.TOSS_SECRET_KEY);
}

/**
 * OAuth2 액세스 토큰 발급 (client_credentials)
 * - 메모리 캐시 사용, 만료 60초 전까지 재사용
 * @returns 유효한 액세스 토큰 문자열
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();

  // 캐시가 유효하면 재사용
  if (tokenCache && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const clientId = process.env.TOSS_API_KEY;
  const clientSecret = process.env.TOSS_SECRET_KEY;
  if (!clientId || !clientSecret) {
    throw new Error('토스 API 자격증명이 없습니다. .env의 TOSS_API_KEY / TOSS_SECRET_KEY를 확인하세요.');
  }

  // form-urlencoded 바디로 토큰 요청
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  });

  try {
    const res = await axios.post(`${TOSS_BASE_URL}/oauth2/token`, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const { access_token, expires_in } = res.data as { access_token: string; expires_in: number };

    // 만료 60초 마진을 두고 캐시
    tokenCache = {
      accessToken: access_token,
      expiresAt: now + Math.max(0, (expires_in - 60)) * 1000
    };

    console.log('✅ 토스 액세스 토큰 발급 완료');
    return access_token;
  } catch (error: any) {
    console.error('❌ 토스 토큰 발급 실패:', error.response?.data || error.message);
    throw new Error(`토스 토큰 발급 실패: ${error.response?.status || ''} ${error.message}`);
  }
}

/**
 * 주문/계좌 호출에 필요한 계좌 식별키(accountSeq) 조회
 * - TOSS_ACCOUNT_SEQ 환경변수가 있으면 우선 사용
 * - 없으면 /accounts에서 BROKERAGE 계좌의 accountSeq를 1회 조회 후 캐시
 * @returns X-Tossinvest-Account 헤더에 넣을 accountSeq 문자열
 */
export async function getAccountSeq(): Promise<string> {
  if (process.env.TOSS_ACCOUNT_SEQ) {
    return process.env.TOSS_ACCOUNT_SEQ;
  }
  if (accountSeqCache) {
    return accountSeqCache;
  }

  const accounts = await tossRequest<Array<{ accountNo: string; accountSeq: number; accountType: string }>>(
    'get',
    '/api/v1/accounts'
  );

  // 현재 BROKERAGE 계좌만 지원됨
  const brokerage = accounts.find(a => a.accountType === 'BROKERAGE') || accounts[0];
  if (!brokerage) {
    throw new Error('토스 계좌를 찾을 수 없습니다. /accounts 응답이 비어 있습니다.');
  }

  accountSeqCache = String(brokerage.accountSeq);
  console.log(`✅ 토스 계좌 확인: ${brokerage.accountNo} (seq=${accountSeqCache})`);
  return accountSeqCache;
}

// =============================================================
// 공통 요청 래퍼
// =============================================================

interface TossRequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  withAccount?: boolean; // X-Tossinvest-Account 헤더 포함 여부
}

/**
 * 토스 API 공통 호출 래퍼
 * - Authorization 헤더 자동 주입, 필요 시 X-Tossinvest-Account 주입
 * - 응답의 { result } 래퍼를 벗겨서 반환
 * @param method HTTP 메서드
 * @param path   API 경로 (/api/v1/...)
 * @param opts   query / body / withAccount
 * @returns result 페이로드 (제네릭 T)
 */
export async function tossRequest<T>(
  method: 'get' | 'post',
  path: string,
  opts: TossRequestOptions = {}
): Promise<T> {
  const token = await getAccessToken();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`
  };
  if (opts.withAccount) {
    headers['X-Tossinvest-Account'] = await getAccountSeq();
  }
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  // undefined 쿼리 값 제거
  const params: Record<string, string | number | boolean> = {};
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) params[k] = v;
    }
  }

  const config: AxiosRequestConfig = {
    method,
    url: `${TOSS_BASE_URL}${path}`,
    headers,
    params,
    data: opts.body
  };

  // 레이트리밋(429) / 일시적 서버오류(5xx)에 대해 지수 백오프 재시도
  const maxAttempts = 4;
  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await axios.request(config);
      // 토스 응답은 { result: ... } 래퍼
      return (res.data?.result ?? res.data) as T;
    } catch (error: any) {
      lastError = error;
      const status = error.response?.status;
      const retryable = status === 429 || (status >= 500 && status < 600);

      if (retryable && attempt < maxAttempts) {
        // Retry-After 헤더 우선, 없으면 지수 백오프 (0.5s, 1s, 2s)
        const retryAfter = parseFloat(error.response?.headers?.['retry-after'] || '');
        const delayMs = isFinite(retryAfter) ? retryAfter * 1000 : 500 * Math.pow(2, attempt - 1);
        console.warn(`⏳ 토스 ${status} [${method.toUpperCase()} ${path}] ${attempt}/${maxAttempts} 재시도 (${delayMs}ms 후)`);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      break;
    }
  }

  const status = lastError.response?.status;
  const data = lastError.response?.data;
  console.error(`❌ 토스 API 오류 [${method.toUpperCase()} ${path}] status=${status}:`, data || lastError.message);
  throw new Error(`토스 API 오류 (${status || 'NETWORK'}): ${JSON.stringify(data) || lastError.message}`);
}

// =============================================================
// 시세 / 환율
// =============================================================

/**
 * 현재가 조회
 * @param symbols 종목 심볼 배열 (US 티커)
 * @returns 심볼 → 현재가(숫자) 맵
 */
export async function getPrices(symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};

  const result = await tossRequest<Array<{ symbol: string; lastPrice: string }>>(
    'get',
    '/api/v1/prices',
    { query: { symbols: symbols.join(',') } }
  );

  const map: Record<string, number> = {};
  for (const item of result) {
    map[item.symbol] = parseFloat(item.lastPrice);
  }
  return map;
}

/**
 * 캔들(봉) 조회
 * @param symbol   종목 심볼
 * @param interval 봉 단위 ('1d' 일봉 / '1m' 분봉), 기본 '1d'
 * @param count    조회 봉 수 (최대 200), 기본 100
 * @returns 날짜 오름차순 캔들 배열 (숫자 정규화)
 */
export async function getCandles(
  symbol: string,
  interval: '1d' | '1m' = '1d',
  count: number = 100
): Promise<TossCandle[]> {
  const page = await tossRequest<{ candles: Array<{
    timestamp: string; openPrice: string; highPrice: string;
    lowPrice: string; closePrice: string; volume: string;
  }> }>(
    'get',
    '/api/v1/candles',
    { query: { symbol, interval, count: Math.min(count, 200), adjusted: true } }
  );

  const candles = (page.candles || []).map(c => ({
    date: c.timestamp,
    open: parseFloat(c.openPrice),
    high: parseFloat(c.highPrice),
    low: parseFloat(c.lowPrice),
    close: parseFloat(c.closePrice),
    volume: parseFloat(c.volume)
  }));

  // 날짜 오름차순 정렬 (기술지표 계산 호환)
  candles.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return candles;
}

/**
 * 환율 조회
 * @param base  기준 통화 (예: 'USD')
 * @param quote 표시 통화 (예: 'KRW')
 * @returns 1 base = ? quote (숫자)
 */
export async function getExchangeRate(base: string, quote: string): Promise<number> {
  const result = await tossRequest<{ rate: string; midRate: string }>(
    'get',
    '/api/v1/exchange-rate',
    { query: { baseCurrency: base, quoteCurrency: quote } }
  );
  // 매매기준율(midRate)을 평가 기준으로 사용
  return parseFloat(result.midRate || result.rate);
}

// =============================================================
// 계좌 / 자산
// =============================================================

/**
 * 보유 주식 조회 (토스 실계좌 = 정답)
 * @returns 보유 종목 배열 (숫자 정규화)
 */
export async function getHoldings(): Promise<TossHolding[]> {
  const overview = await tossRequest<{ items: Array<{
    symbol: string; quantity: string; averagePurchasePrice: string;
    lastPrice: string; currency: string;
  }> }>(
    'get',
    '/api/v1/holdings',
    { withAccount: true }
  );

  return (overview.items || []).map(item => ({
    symbol: item.symbol,
    shares: parseFloat(item.quantity),
    avg_cost: parseFloat(item.averagePurchasePrice),
    lastPrice: parseFloat(item.lastPrice),
    currency: item.currency
  }));
}

/**
 * 매수 가능 금액 조회
 * @param currency 통화 (기본 'USD')
 * @returns 현금 기반 매수 가능 금액 (숫자)
 */
export async function getBuyingPower(currency: string = 'USD'): Promise<number> {
  const result = await tossRequest<{ cashBuyingPower: string; currency: string }>(
    'get',
    '/api/v1/buying-power',
    { query: { currency }, withAccount: true }
  );
  return parseFloat(result.cashBuyingPower);
}

/**
 * 판매 가능 수량 조회
 * @param symbol 종목 심볼
 * @returns 매도 가능 수량 (숫자)
 */
export async function getSellableQuantity(symbol: string): Promise<number> {
  const result = await tossRequest<{ sellableQuantity: string }>(
    'get',
    '/api/v1/sellable-quantity',
    { query: { symbol }, withAccount: true }
  );
  return parseFloat(result.sellableQuantity);
}

// =============================================================
// 주문 (dry-run 게이트)
// =============================================================

/**
 * 현재 dry-run 모드 여부
 * - TOSS_DRY_RUN이 'false'가 아닌 한 항상 dry-run (안전 기본값)
 */
export function isDryRun(): boolean {
  return process.env.TOSS_DRY_RUN !== 'false';
}

/**
 * 주문 생성
 * - dry-run 모드면 실제 전송 없이 주문안만 로깅하고 합성 결과 반환
 * - 실거래 모드면 POST /api/v1/orders 호출
 * @param req     주문 요청 (숫자 → 문자열 변환은 내부에서 처리)
 * @param options dryRun 명시 오버라이드 (미지정 시 환경변수 따름)
 * @returns 주문 결과
 */
export async function createOrder(
  req: TossOrderRequest,
  options: { dryRun?: boolean } = {}
): Promise<TossOrderResult> {
  const dryRun = options.dryRun ?? isDryRun();

  // 숫자 → 문자열 직렬화 (토스 계약: quantity/price/orderAmount는 문자열)
  const body: Record<string, unknown> = {
    symbol: req.symbol,
    side: req.side,
    orderType: req.orderType
  };
  if (req.quantity !== undefined) body.quantity = String(req.quantity);
  if (req.orderAmount !== undefined) body.orderAmount = String(req.orderAmount);
  if (req.price !== undefined) body.price = String(req.price);
  if (req.timeInForce) body.timeInForce = req.timeInForce;
  if (req.clientOrderId) body.clientOrderId = req.clientOrderId;

  if (dryRun) {
    console.log('🧪 [DRY-RUN] 토스 주문안 (실제 전송 안 함):', JSON.stringify(body));
    return {
      orderId: `dryrun-${req.clientOrderId || req.symbol}-${req.side}`,
      clientOrderId: req.clientOrderId ?? null,
      dryRun: true
    };
  }

  const result = await tossRequest<{ orderId: string; clientOrderId: string | null }>(
    'post',
    '/api/v1/orders',
    { body, withAccount: true }
  );
  console.log(`✅ 토스 주문 생성: ${req.symbol} ${req.side} (orderId=${result.orderId})`);
  return { orderId: result.orderId, clientOrderId: result.clientOrderId, dryRun: false };
}

/**
 * 주문 정정
 * @param orderId 정정할 주문 ID
 * @param changes 변경할 호가유형/수량/가격
 */
export async function modifyOrder(
  orderId: string,
  changes: { orderType: OrderType; quantity?: number; price?: number; confirmHighValueOrder?: boolean }
): Promise<TossOrderResult> {
  const body: Record<string, unknown> = { orderType: changes.orderType };
  if (changes.quantity !== undefined) body.quantity = String(changes.quantity);
  if (changes.price !== undefined) body.price = String(changes.price);
  if (changes.confirmHighValueOrder) body.confirmHighValueOrder = true;

  const result = await tossRequest<{ orderId: string; clientOrderId: string | null }>(
    'post',
    `/api/v1/orders/${orderId}/modify`,
    { body, withAccount: true }
  );
  return { orderId: result.orderId, clientOrderId: result.clientOrderId, dryRun: false };
}

/**
 * 주문 취소
 * @param orderId 취소할 주문 ID
 */
export async function cancelOrder(orderId: string): Promise<TossOrderResult> {
  const result = await tossRequest<{ orderId: string; clientOrderId: string | null }>(
    'post',
    `/api/v1/orders/${orderId}/cancel`,
    { withAccount: true }
  );
  return { orderId: result.orderId, clientOrderId: result.clientOrderId, dryRun: false };
}
