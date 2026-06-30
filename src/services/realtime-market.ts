import { getPrices, getCandles, isTossEnabled } from './toss';

/**
 * 실시간 주식 가격 인터페이스
 */
export interface RealtimePrice {
  symbol: string;
  price: number;
  timestamp: Date;
  session: 'PRE' | 'REGULAR' | 'POST' | 'CLOSED';
  volume?: number;
  bid?: number;
  ask?: number;
}

/**
 * 거래 세션 타입 판별 (미국 동부시간 기준)
 * - PRE: 프리마켓 (4:00-9:30 AM ET)
 * - REGULAR: 정규장 (9:30 AM-4:00 PM ET)
 * - POST: 애프터마켓 (4:00-8:00 PM ET)
 * - CLOSED: 장 마감
 */
function getSessionType(timestamp: Date): 'PRE' | 'REGULAR' | 'POST' | 'CLOSED' {
  // ET (Eastern Time) 기준으로 변환
  const etTime = new Date(timestamp.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = etTime.getHours();
  const minute = etTime.getMinutes();
  const timeInMinutes = hour * 60 + minute;

  // 프리마켓: 4:00-9:30 AM (240-570분)
  if (timeInMinutes >= 240 && timeInMinutes < 570) return 'PRE';

  // 정규장: 9:30 AM-4:00 PM (570-960분)
  if (timeInMinutes >= 570 && timeInMinutes < 960) return 'REGULAR';

  // 애프터마켓: 4:00-8:00 PM (960-1200분)
  if (timeInMinutes >= 960 && timeInMinutes < 1200) return 'POST';

  return 'CLOSED';
}

/**
 * 실시간(최신) 주식 가격 조회 (토스증권 현재가 REST)
 *
 * @param symbols - 조회할 종목 심볼 배열
 * @param _waitTimeMs - (호환용, 토스 REST에서는 미사용)
 * @returns 각 종목의 최신 가격 정보
 */
export async function getCurrentPrices(
  symbols: string[],
  _waitTimeMs: number = 5000
): Promise<Record<string, RealtimePrice>> {
  // 토스는 REST 현재가를 제공하므로 웹소켓 없이 동일하게 처리
  return getLatestPrices(symbols);
}

/**
 * 특정 종목의 최신 가격 조회 (토스증권 현재가 REST)
 *
 * @param symbols - 조회할 종목 심볼 배열
 * @returns 각 종목의 최신 가격 정보
 */
export async function getLatestPrices(symbols: string[]): Promise<Record<string, RealtimePrice>> {
  if (symbols.length === 0) {
    return {};
  }

  console.log(`📊 최신 가격 조회 (토스): ${symbols.join(', ')}`);

  try {
    const priceMap = await getPrices(symbols);
    const now = new Date();
    const session = getSessionType(now);

    const prices: Record<string, RealtimePrice> = {};
    for (const [symbol, price] of Object.entries(priceMap)) {
      prices[symbol] = {
        symbol,
        price,
        timestamp: now,
        session
      };
      console.log(`💰 ${symbol}: $${price} (${session})`);
    }

    console.log(`✅ 최신 가격 조회 완료 (${Object.keys(prices).length}개 종목)`);
    return prices;
  } catch (error: any) {
    console.error('❌ 최신 가격 조회 실패:', error.message);
    throw error;
  }
}

/**
 * 현재 시장 세션 상태 확인
 *
 * @returns 현재 거래 세션 타입
 */
export function getCurrentMarketSession(): 'PRE' | 'REGULAR' | 'POST' | 'CLOSED' {
  return getSessionType(new Date());
}

/**
 * 실시간 가격 조회 가능 여부 확인
 *
 * @returns 토스 API 설정 여부
 */
export function isRealtimePriceEnabled(): boolean {
  return isTossEnabled();
}

/**
 * 히스토리 가격 데이터 조회 (기술지표 계산용, 토스증권 일봉 캔들)
 *
 * @param symbol - 종목 심볼
 * @param days - 조회할 일수 (기본 100일, 토스 최대 200봉)
 * @returns 일일 가격 데이터 배열 (날짜 오름차순)
 */
export async function getHistoricalPrices(
  symbol: string,
  days: number = 100
): Promise<Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>> {
  if (!isRealtimePriceEnabled()) {
    throw new Error('토스 API가 설정되지 않았습니다.');
  }

  console.log(`📊 ${symbol} 히스토리 데이터 조회 중 (최근 ${days}일)...`);

  try {
    const candles = await getCandles(symbol, '1d', days);

    // TossCandle → 표준 일봉 (date는 YYYY-MM-DD로 정규화)
    const priceData = candles.map(c => ({
      date: c.date.split('T')[0],
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume
    }));

    console.log(`✅ ${symbol} 히스토리 데이터 ${priceData.length}일 조회 완료`);
    return priceData;

  } catch (error: any) {
    console.error(`❌ ${symbol} 히스토리 데이터 조회 실패:`, error.message);
    throw error;
  }
}

/**
 * 여러 종목의 히스토리 데이터 일괄 조회
 *
 * @param symbols - 종목 심볼 배열
 * @param days - 조회할 일수 (기본 100일)
 * @returns 종목별 히스토리 데이터
 */
export async function getBulkHistoricalPrices(
  symbols: string[],
  days: number = 100
): Promise<Record<string, Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>>> {
  const results: Record<string, Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>> = {};

  console.log(`📊 ${symbols.length}개 종목 히스토리 데이터 일괄 조회 중...`);

  for (const symbol of symbols) {
    try {
      results[symbol] = await getHistoricalPrices(symbol, days);
    } catch (error) {
      console.warn(`⚠️ ${symbol} 히스토리 조회 실패, 빈 배열 반환`);
      results[symbol] = [];
    }
  }

  console.log(`✅ 히스토리 데이터 일괄 조회 완료 (${Object.keys(results).length}개 종목)`);

  return results;
}
