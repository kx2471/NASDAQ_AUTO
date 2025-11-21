import Alpaca from '@alpacahq/alpaca-trade-api';

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
 * 거래 세션 타입 판별
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
 * Alpaca 클라이언트 생성
 */
function createAlpacaClient() {
  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  const isPaper = process.env.ALPACA_PAPER !== 'false';

  if (!apiKey || !secretKey) {
    throw new Error('Alpaca API 키가 설정되지 않았습니다. .env 파일을 확인하세요.');
  }

  return new Alpaca({
    keyId: apiKey,
    secretKey: secretKey,
    paper: isPaper,
    feed: 'iex' // IEX 데이터 피드 사용 (무료)
  });
}

/**
 * 실시간 주식 가격 조회 (웹소켓)
 *
 * @param symbols - 조회할 종목 심볼 배열 (최대 30개, Alpaca 무료 제한)
 * @param waitTimeMs - 웹소켓 연결 후 대기 시간 (기본 5초)
 * @returns 각 종목의 실시간 가격 정보
 */
export async function getCurrentPrices(
  symbols: string[],
  waitTimeMs: number = 5000
): Promise<Record<string, RealtimePrice>> {
  if (symbols.length === 0) {
    return {};
  }

  if (symbols.length > 30) {
    console.warn('⚠️ Alpaca 무료 티어는 최대 30개 종목까지 지원합니다.');
    symbols = symbols.slice(0, 30);
  }

  console.log(`📡 실시간 가격 조회 시작: ${symbols.join(', ')}`);

  try {
    const alpaca = createAlpacaClient();
    const prices: Record<string, RealtimePrice> = {};

    // 웹소켓 데이터 스트림 생성
    const dataStream = alpaca.data_stream_v2;

    return new Promise((resolve, reject) => {
      let isResolved = false;

      // 주식 거래 데이터 수신 핸들러
      dataStream.onStockTrade((trade: any) => {
        const timestamp = new Date(trade.Timestamp);
        prices[trade.Symbol] = {
          symbol: trade.Symbol,
          price: trade.Price,
          timestamp: timestamp,
          session: getSessionType(timestamp),
          volume: trade.Size
        };

        console.log(`💰 ${trade.Symbol}: $${trade.Price} (${getSessionType(timestamp)})`);
      });

      // 주식 호가 데이터 수신 핸들러 (선택적)
      dataStream.onStockQuote((quote: any) => {
        if (prices[quote.Symbol]) {
          prices[quote.Symbol].bid = quote.BidPrice;
          prices[quote.Symbol].ask = quote.AskPrice;
        }
      });

      // 연결 에러 핸들러
      dataStream.onError((error: any) => {
        console.error('❌ Alpaca 웹소켓 에러:', error);
        if (!isResolved) {
          isResolved = true;
          reject(error);
        }
      });

      // 연결 성공 핸들러
      dataStream.onConnect(() => {
        console.log('✅ Alpaca 웹소켓 연결 성공');

        // 거래 데이터 구독
        dataStream.subscribeForTrades(symbols);

        // 호가 데이터 구독 (선택적)
        dataStream.subscribeForQuotes(symbols);

        // 지정된 시간 후 연결 종료 및 결과 반환
        setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            dataStream.unsubscribeFromTrades(symbols);
            dataStream.unsubscribeFromQuotes(symbols);

            console.log(`✅ 실시간 가격 조회 완료 (${Object.keys(prices).length}개 종목)`);
            resolve(prices);
          }
        }, waitTimeMs);
      });

      // 웹소켓 연결 시작
      dataStream.connect();
    });
  } catch (error: any) {
    console.error('❌ 실시간 가격 조회 실패:', error.message);
    throw error;
  }
}

/**
 * 특정 종목의 최신 스냅샷 가격 조회 (REST API)
 * 웹소켓 대신 간단한 REST API로 최신 가격 조회
 *
 * @param symbols - 조회할 종목 심볼 배열
 * @returns 각 종목의 최신 가격 정보
 */
export async function getLatestPrices(symbols: string[]): Promise<Record<string, RealtimePrice>> {
  if (symbols.length === 0) {
    return {};
  }

  console.log(`📊 최신 가격 조회 (REST): ${symbols.join(', ')}`);

  try {
    const alpaca = createAlpacaClient();
    const prices: Record<string, RealtimePrice> = {};

    // 각 종목의 최신 거래 정보 조회
    for (const symbol of symbols) {
      try {
        const latestTrade = await alpaca.getLatestTrade(symbol);

        const timestamp = new Date(latestTrade.Timestamp);
        prices[symbol] = {
          symbol: symbol,
          price: latestTrade.Price,
          timestamp: timestamp,
          session: getSessionType(timestamp),
          volume: latestTrade.Size
        };

        console.log(`💰 ${symbol}: $${latestTrade.Price} (${getSessionType(timestamp)})`);
      } catch (error: any) {
        console.warn(`⚠️ ${symbol} Alpaca 조회 실패, Yahoo Finance 시도:`, error.message);

        // Yahoo Finance fallback (개별 종목)
        try {
          const { fetchDailyPrices } = await import('./market');
          const yahooPrices = await fetchDailyPrices([symbol]);

          if (yahooPrices[symbol] && yahooPrices[symbol].length > 0) {
            const latestPrice = yahooPrices[symbol][yahooPrices[symbol].length - 1];
            prices[symbol] = {
              symbol: symbol,
              price: latestPrice.close,
              timestamp: new Date(),
              session: 'CLOSED', // Yahoo는 종가이므로 CLOSED
              volume: latestPrice.volume
            };
            console.log(`💰 ${symbol}: $${latestPrice.close} (Yahoo 종가)`);
          } else {
            console.error(`❌ ${symbol} Yahoo Finance도 실패 - 데이터 없음`);
          }
        } catch (yahooError: any) {
          console.error(`❌ ${symbol} Yahoo Finance 실패:`, yahooError.message);
        }
      }
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
 * @returns Alpaca API 설정 여부
 */
export function isRealtimePriceEnabled(): boolean {
  return !!(process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY);
}

/**
 * 히스토리 가격 데이터 조회 (기술지표 계산용)
 * Alpaca API로 최근 100일 일일 가격 데이터 조회
 *
 * @param symbol - 종목 심볼
 * @param days - 조회할 일수 (기본 100일)
 * @returns 일일 가격 데이터 배열
 */
export async function getHistoricalPrices(
  symbol: string,
  days: number = 100
): Promise<Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>> {
  if (!isRealtimePriceEnabled()) {
    throw new Error('Alpaca API가 설정되지 않았습니다.');
  }

  console.log(`📊 ${symbol} 히스토리 데이터 조회 중 (최근 ${days}일)...`);

  try {
    const alpaca = createAlpacaClient();

    // 종료일: 오늘
    const endDate = new Date();

    // 시작일: days일 전 (주말 고려하여 여유있게)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days + 30)); // 여유있게 30일 더

    // Alpaca bars API 호출
    const bars = await alpaca.getBarsV2(symbol, {
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0],
      timeframe: '1Day',
      limit: days
    });

    const priceData: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }> = [];

    // bars를 배열로 변환
    for await (const bar of bars) {
      priceData.push({
        date: bar.Timestamp.split('T')[0], // YYYY-MM-DD 형식
        open: bar.OpenPrice,
        high: bar.HighPrice,
        low: bar.LowPrice,
        close: bar.ClosePrice,
        volume: bar.Volume
      });
    }

    // 날짜 오름차순 정렬
    priceData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

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
