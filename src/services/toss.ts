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
// 동시 토큰 발급 경합 방지: 토스는 새 토큰 발급 시 기존 토큰을 무효화하므로,
// 병렬 호출이 각자 발급하면 먼저 받은 쪽이 401(invalid-token)로 실패한다.
let tokenInFlight: Promise<string> | null = null;
let accountSeqInFlight: Promise<string> | null = null;

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
  // 캐시가 유효하면 재사용
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  // 이미 발급이 진행 중이면 그 결과를 공유 (single-flight)
  if (tokenInFlight) {
    return tokenInFlight;
  }

  tokenInFlight = issueAccessToken().finally(() => { tokenInFlight = null; });
  return tokenInFlight;
}

/**
 * 실제 토큰 발급 요청 (getAccessToken 내부 전용)
 * @returns 새로 발급된 액세스 토큰
 */
async function issueAccessToken(): Promise<string> {
  const now = Date.now();
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

  // 병렬 호출이 /accounts를 중복 조회하지 않도록 single-flight (429 예방)
  if (accountSeqInFlight) {
    return accountSeqInFlight;
  }

  accountSeqInFlight = (async () => {
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
  })().finally(() => { accountSeqInFlight = null; });

  return accountSeqInFlight;
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
  // undefined 쿼리 값 제거
  const params: Record<string, string | number | boolean> = {};
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) params[k] = v;
    }
  }

  // 레이트리밋(429) / 일시적 서버오류(5xx)에 대해 지수 백오프 재시도
  const maxAttempts = 4;
  let lastError: any;
  let authRetried = false; // 401 토큰 재발급 재시도는 1회만

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 헤더는 매 시도마다 구성 (401 재발급 시 새 토큰 반영을 위해 루프 안에서)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await getAccessToken()}`
    };
    if (opts.withAccount) {
      headers['X-Tossinvest-Account'] = await getAccountSeq();
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const config: AxiosRequestConfig = {
      method,
      url: `${TOSS_BASE_URL}${path}`,
      headers,
      params,
      data: opts.body
    };

    try {
      const res = await axios.request(config);
      // 토스 응답은 { result: ... } 래퍼
      return (res.data?.result ?? res.data) as T;
    } catch (error: any) {
      lastError = error;
      const status = error.response?.status;

      // 401: 다른 프로세스가 새 토큰을 발급해 기존 토큰이 무효화된 경우 — 캐시 비우고 1회 재발급
      if (status === 401 && !authRetried) {
        authRetried = true;
        tokenCache = null;
        console.warn(`🔁 토스 토큰 무효화 감지(401) [${method.toUpperCase()} ${path}] — 재발급 후 재시도`);
        continue;
      }

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

  const map: Record<string, number> = {};

  // API 한도: 콜당 최대 200종목 — 초과 시 청크 분할
  for (let i = 0; i < symbols.length; i += 200) {
    const chunk = symbols.slice(i, i + 200);
    const result = await tossRequest<Array<{ symbol: string; lastPrice: string }>>(
      'get',
      '/api/v1/prices',
      { query: { symbols: chunk.join(',') } }
    );

    for (const item of result) {
      map[item.symbol] = parseFloat(item.lastPrice);
    }
  }
  return map;
}

/** 종목 기본 정보 (숫자 정규화) */
export interface TossStockInfo {
  symbol: string;
  name: string;            // 종목명 (한글)
  englishName: string;
  market: string;          // 상장 시장 세그먼트
  securityType: string;    // 종목 유형
  isCommonShare: boolean;  // 보통주 여부 (ETF/우선주/워런트 등은 false)
  status: string;          // 상장 상태
  currency: string;
  delistDate: string | null;      // 상장폐지일 (활성 종목은 null)
  sharesOutstanding: number;      // 발행주식수
}

/**
 * 종목 기본 정보 일괄 조회 (/api/v1/stocks, 콜당 최대 200종목)
 * - 상장 상태·보통주 여부·통화 등 유니버스 검증용 참조 데이터
 * @param symbols 조회할 심볼 배열 (개수 제한 없음 — 내부에서 200개씩 분할)
 * @returns 조회된 종목 정보 배열 (토스에 없는 심볼은 응답에서 빠짐)
 */
export async function getStockInfos(symbols: string[]): Promise<TossStockInfo[]> {
  if (symbols.length === 0) return [];

  const infos: TossStockInfo[] = [];

  for (let i = 0; i < symbols.length; i += 200) {
    const chunk = symbols.slice(i, i + 200);
    const result = await tossRequest<Array<{
      symbol: string; name: string; englishName: string; market: string;
      securityType: string; isCommonShare: boolean; status: string;
      currency: string; delistDate: string | null; sharesOutstanding: string;
    }>>(
      'get',
      '/api/v1/stocks',
      { query: { symbols: chunk.join(',') } }
    );

    for (const item of result) {
      infos.push({
        symbol: item.symbol,
        name: item.name,
        englishName: item.englishName,
        market: item.market,
        securityType: item.securityType,
        isCommonShare: item.isCommonShare,
        status: item.status,
        currency: item.currency,
        delistDate: item.delistDate,
        sharesOutstanding: parseFloat(item.sharesOutstanding) || 0
      });
    }
  }
  return infos;
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
// 미국 장 운영 캘린더 / 세션
// =============================================================

/** 세션 시간 구간 (epoch ms) */
export interface UsMarketSession {
  start: number;
  end: number;
}

/** 미국 영업일 정보 (정규장 중심) */
export interface UsMarketDayInfo {
  date: string;                       // 영업일 (미국 현지 기준, YYYY-MM-DD)
  regular: UsMarketSession | null;    // 정규장 구간 (휴장이면 null)
}

interface UsCalendarCache {
  fetchedAt: number;
  previous: UsMarketDayInfo;
  today: UsMarketDayInfo;
  next: UsMarketDayInfo;
}

let usCalendarCache: UsCalendarCache | null = null;
const US_CALENDAR_TTL_MS = 10 * 60 * 1000; // 10분 캐시 (스케줄러가 매분 조회해도 콜 낭비 없도록)

/** 캘린더 응답의 세션 파싱 (null 허용) */
function parseSession(session: { startTime: string; endTime: string } | null): UsMarketSession | null {
  if (!session) return null;
  return {
    start: new Date(session.startTime).getTime(),
    end: new Date(session.endTime).getTime()
  };
}

/**
 * 미국 장 운영 캘린더 조회 (/api/v1/market-calendar/US, 10분 캐시)
 * - 응답은 KST 기준 ISO 시각 — epoch ms로 정규화
 * - 토스의 `today`는 **한국 날짜 기준**이고 미국 정규장은 한국 자정을 횡단한다
 *   (예: today=07-30 → regular 07/30 22:30 ~ 07/31 05:00 KST).
 *   따라서 자정 이후에는 "진행 중인 세션"이 `previousBusinessDay`에 들어있다 —
 *   전일 정보를 반드시 함께 보관한다 (2026-07-30 GPN 익절 미발동의 원인).
 * @returns 전일·오늘·다음 영업일의 정규장 구간
 */
export async function getUsMarketCalendar(): Promise<{ previous: UsMarketDayInfo; today: UsMarketDayInfo; next: UsMarketDayInfo }> {
  if (usCalendarCache && Date.now() - usCalendarCache.fetchedAt < US_CALENDAR_TTL_MS) {
    return { previous: usCalendarCache.previous, today: usCalendarCache.today, next: usCalendarCache.next };
  }

  const result = await tossRequest<{
    previousBusinessDay: { date: string; regularMarket: { startTime: string; endTime: string } | null };
    today: { date: string; regularMarket: { startTime: string; endTime: string } | null };
    nextBusinessDay: { date: string; regularMarket: { startTime: string; endTime: string } | null };
  }>('get', '/api/v1/market-calendar/US');

  usCalendarCache = {
    fetchedAt: Date.now(),
    previous: { date: result.previousBusinessDay.date, regular: parseSession(result.previousBusinessDay.regularMarket) },
    today: { date: result.today.date, regular: parseSession(result.today.regularMarket) },
    next: { date: result.nextBusinessDay.date, regular: parseSession(result.nextBusinessDay.regularMarket) }
  };

  return { previous: usCalendarCache.previous, today: usCalendarCache.today, next: usCalendarCache.next };
}

/**
 * 지금 진행 중인 정규장 세션 (없으면 null)
 *
 * 세션이 한국 자정을 넘기므로 전일·오늘 두 후보를 모두 검사한다.
 * "24시간 빼기"로 추정하지 않는 이유: 월요일 새벽에 존재하지 않는
 * (일요일 22:30~월요일 05:00) 세션을 열려 있다고 오판해, 낡은 금요일 종가로
 * 손절이 발동하는 유령 매도가 가능해진다. 휴일·DST는 토스가 계산해 준다.
 * @returns 진행 중인 세션 구간, 아니면 null
 */
export async function getActiveRegularSession(): Promise<UsMarketSession | null> {
  const { previous, today } = await getUsMarketCalendar();
  const now = Date.now();
  for (const s of [previous.regular, today.regular]) {
    if (s && now >= s.start && now < s.end) return s;
  }
  return null;
}

/**
 * 이미 시작된 세션 중 가장 최근 것의 시작 시각 (없으면 null)
 * - 일일 매수 한도 창의 기준점. `today.regular.start`를 그대로 쓰면 자정 이후엔
 *   미래 시각이 되어 한도가 리셋되는 구멍이 생긴다.
 * @returns 최근 세션 시작 epoch ms, 판정 불가면 null
 */
export async function getLatestSessionStart(): Promise<number | null> {
  const { previous, today } = await getUsMarketCalendar();
  const now = Date.now();
  const started = [today.regular?.start, previous.regular?.start]
    .filter((s): s is number => typeof s === 'number' && s <= now);
  return started.length ? Math.max(...started) : null;
}

/**
 * 집행이 일어날 세션의 시작 시각 — **판단(계획) 시점용**.
 *
 * getLatestSessionStart()는 "이미 시작된" 세션만 보므로 개장 전에는 어제 세션을
 * 가리킨다. 그런데 리포트 파이프라인은 개장 40분 전(REPORT_LEAD_MINUTES)에 돌고
 * 집행은 개장 후에 일어나므로, 판단 시점에 그 값을 쓰면 어제 매수액을 차감한
 * 잘못된 여력을 계산한다.
 * (2026-08-14 실측: 21:57 판단 시점에 "남은 여력 $133"이 주입됐으나 22:30 집행
 *  시점의 실제 여력은 $400이었다. Manager가 쓸 수 있는 돈의 1/3만 배분했고,
 *  한도 안이라 거부·클램프 어느 쪽도 걸리지 않아 조용히 지나갔다)
 * @returns 개장 중이면 그 세션, 개장 전이면 곧 열릴 세션의 시작 epoch ms
 */
export async function getExecutionSessionStart(): Promise<number | null> {
  const active = await getActiveRegularSession();
  if (active) return active.start;
  const { today, next } = await getUsMarketCalendar();
  const now = Date.now();
  if (today.regular && now < today.regular.start) return today.regular.start;
  return next.regular?.start ?? null;
}

/**
 * 지금이 미국 정규장 시간인지 확인
 * - 프리마켓/애프터마켓/휴장은 모두 false — "정규장 전용 거래" 정책의 기준 함수
 * @returns 정규장 개장 중이면 true
 */
export async function isUsRegularSessionOpen(): Promise<boolean> {
  return (await getActiveRegularSession()) !== null;
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

/** 미체결(진행 중) 주문 (숫자 정규화) */
export interface TossOpenOrder {
  orderId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  status: string;          // 세부 상태 (예: SUBMITTED, PARTIALLY_FILLED 등)
  quantity?: number;       // 수량기반 주문
  orderAmount?: number;    // 금액기반 주문 (USD)
  price?: number;          // LIMIT 지정가
  currency: string;
  orderedAt: string;
}

/**
 * 미체결 주문 목록 조회 (status=OPEN — 전량 반환, 페이지네이션 없음)
 * - 체결 대기 중인 매수대금(평가액 계산)·미체결 감시 등에 사용
 * @returns 진행 중 주문 배열
 */
export async function getOpenOrders(): Promise<TossOpenOrder[]> {
  const result = await tossRequest<{ orders: Array<{
    orderId: string; symbol: string; side: OrderSide; orderType: OrderType;
    status: string; quantity?: string; orderAmount?: string; price?: string;
    currency: string; orderedAt: string;
  }> }>(
    'get',
    '/api/v1/orders',
    { query: { status: 'OPEN' }, withAccount: true }
  );

  return (result.orders || []).map(o => ({
    orderId: o.orderId,
    symbol: o.symbol,
    side: o.side,
    orderType: o.orderType,
    status: o.status,
    quantity: o.quantity !== undefined ? parseFloat(o.quantity) : undefined,
    orderAmount: o.orderAmount !== undefined ? parseFloat(o.orderAmount) : undefined,
    price: o.price !== undefined ? parseFloat(o.price) : undefined,
    currency: o.currency,
    orderedAt: o.orderedAt
  }));
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
