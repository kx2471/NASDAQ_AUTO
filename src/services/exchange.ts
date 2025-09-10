import axios from 'axios';

/**
 * 환율 데이터 인터페이스
 */
export interface ExchangeRate {
  usd_to_krw: number;
  updated_at: string;
}

/**
 * 실시간 USD/KRW 환율 조회
 * exchangerate-api.com 사용 (무료, 1500 requests/month)
 */
export async function fetchUSDToKRW(): Promise<ExchangeRate> {
  try {
    // exchangerate-api.com - 무료 API (키 불필요)
    const response = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
    const data = response.data;
    
    if (!data.rates || !data.rates.KRW) {
      throw new Error('환율 데이터를 찾을 수 없습니다');
    }
    
    return {
      usd_to_krw: data.rates.KRW,
      updated_at: new Date().toISOString()
    };
    
  } catch (error) {
    console.warn('⚠️ 실시간 환율 조회 실패, 기본값 사용:', error);
    
    // 백업: 고정 환율 사용
    return {
      usd_to_krw: 1340, // 기본값
      updated_at: new Date().toISOString()
    };
  }
}

/**
 * Fixer.io API를 사용한 환율 조회 (백업)
 * 무료 계정: 100 requests/month
 */
export async function fetchUSDToKRWFromFixer(): Promise<ExchangeRate> {
  try {
    // Fixer.io 무료 API (키 불필요, 제한적)
    const response = await axios.get('http://data.fixer.io/api/latest?access_key=FREE&base=USD&symbols=KRW');
    const data = response.data;
    
    if (!data.success || !data.rates || !data.rates.KRW) {
      throw new Error('Fixer.io에서 환율 데이터를 가져올 수 없습니다');
    }
    
    return {
      usd_to_krw: data.rates.KRW,
      updated_at: new Date().toISOString()
    };
    
  } catch (error) {
    console.warn('⚠️ Fixer.io 환율 조회 실패:', error);
    throw error;
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