import { getExchangeRate } from './toss';

/**
 * 환율 데이터 인터페이스
 */
export interface ExchangeRate {
  usd_to_krw: number;
  updated_at: string;
}

/**
 * 실시간 USD/KRW 환율 조회 (토스증권 환율 API)
 * - 토스 매매기준율(midRate) 사용
 * - 실패 시 USD_KRW_RATE 환경변수 또는 고정값으로 폴백
 */
export async function fetchUSDToKRW(): Promise<ExchangeRate> {
  try {
    const rate = await getExchangeRate('USD', 'KRW');

    if (!rate || !isFinite(rate)) {
      throw new Error('환율 데이터를 찾을 수 없습니다');
    }

    return {
      usd_to_krw: rate,
      updated_at: new Date().toISOString()
    };

  } catch (error) {
    console.warn('⚠️ 토스 환율 조회 실패, 기본값 사용:', error);

    // 백업: 환경변수 또는 고정 환율 사용
    const fallback = parseFloat(process.env.USD_KRW_RATE || '') || 1340;
    return {
      usd_to_krw: fallback,
      updated_at: new Date().toISOString()
    };
  }
}

/**
 * 원화를 달러로 변환
 */
export function convertKRWToUSD(krwAmount: number, exchangeRate: number): number {
  return krwAmount / exchangeRate;
}

/**
 * 달러를 원화로 변환
 */
export function convertUSDToKRW(usdAmount: number, exchangeRate: number): number {
  return usdAmount * exchangeRate;
}

/**
 * 실시간 환율 캐시 (5분간 유효)
 */
let exchangeRateCache: { rate: ExchangeRate; expiry: number } | null = null;

/**
 * 캐시된 환율 조회 (5분간 유효)
 */
export async function getCachedExchangeRate(): Promise<ExchangeRate> {
  const now = Date.now();
  
  // 캐시가 유효한 경우
  if (exchangeRateCache && now < exchangeRateCache.expiry) {
    return exchangeRateCache.rate;
  }
  
  // 새로운 환율 조회
  const rate = await fetchUSDToKRW();
  
  // 5분간 캐시
  exchangeRateCache = {
    rate,
    expiry: now + (5 * 60 * 1000)
  };
  
  return rate;
}