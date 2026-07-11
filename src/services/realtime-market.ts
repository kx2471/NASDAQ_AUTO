import { getPrices, isTossEnabled } from './toss';

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

// (참고) 일봉 히스토리는 market.ts의 fetchDailyPrices가 담당한다 — 동일 토스 캔들 소스라
// 과거 Alpaca 시절의 getHistoricalPrices/getBulkHistoricalPrices 보완 경로는 제거됨.
