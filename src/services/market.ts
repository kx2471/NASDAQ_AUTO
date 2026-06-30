import { getCandles } from './toss';

/**
 * 시장 데이터 인터페이스
 */
export interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorData {
  ema20: number;
  ema50: number;
  rsi14: number;
}

/**
 * 주식 기본 정보 인터페이스
 */
export interface StockBasicInfo {
  symbol: string;
  marketCap?: number;
  avgVolume?: number;
  peRatio?: number;
  dividendYield?: number;
  isActive: boolean;
  hasMinimumData: boolean;
}

/**
 * 일일 가격 데이터 수집 (토스증권 캔들 기반)
 * @param symbols 종목 심볼 배열
 * @returns 심볼 → 일봉 가격 데이터 배열
 */
export async function fetchDailyPrices(symbols: string[]): Promise<Record<string, PriceData[]>> {
  const results: Record<string, PriceData[]> = {};

  for (const symbol of symbols) {
    try {
      results[symbol] = await fetchFromToss(symbol);
    } catch (error) {
      console.error(`❌ ${symbol} 가격 데이터 수집 실패:`, error);
      results[symbol] = [];
    }
  }

  return results;
}

/**
 * 토스증권에서 일봉 가격 데이터 수집
 * - 토스 캔들(TossCandle)을 시스템 표준 PriceData로 변환
 * @param symbol 종목 심볼
 * @returns 날짜 오름차순 일봉 배열 (날짜는 YYYY-MM-DD)
 */
async function fetchFromToss(symbol: string): Promise<PriceData[]> {
  const candles = await getCandles(symbol, '1d', 100);

  // TossCandle → PriceData (date는 YYYY-MM-DD로 정규화)
  return candles.map(c => ({
    date: c.date.split('T')[0],
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume
  }));
}

/**
 * 기술지표 계산
 * EMA(20, 50), RSI(14) 계산
 */
export function computeIndicators(prices: number[]): IndicatorData {
  if (prices.length < 50) {
    throw new Error('기술지표 계산을 위해 최소 50일 데이터가 필요합니다');
  }

  const ema20 = calculateEMA(prices, 20);
  const ema50 = calculateEMA(prices, 50);
  const rsi14 = calculateRSI(prices, 14);

  return {
    ema20: ema20[ema20.length - 1],
    ema50: ema50[ema50.length - 1],
    rsi14: rsi14[rsi14.length - 1]
  };
}

/**
 * 부분 기술지표 계산 (데이터가 부족한 경우)
 * - 20일 이상: EMA20, RSI14만 계산
 * - 15일 이상: RSI14만 계산
 * - 그 이하: null 반환
 */
export function computeIndicatorsPartial(prices: number[]): Partial<IndicatorData> | null {
  if (prices.length < 15) {
    return null; // 최소 데이터 부족
  }

  const result: Partial<IndicatorData> = {};

  // RSI14 계산 (최소 15일 필요)
  try {
    if (prices.length >= 15) {
      const rsi14 = calculateRSI(prices, 14);
      result.rsi14 = rsi14[rsi14.length - 1];
    }
  } catch (error) {
    console.warn('RSI14 계산 실패:', error);
  }

  // EMA20 계산 (최소 20일 필요)
  try {
    if (prices.length >= 20) {
      const ema20 = calculateEMA(prices, 20);
      result.ema20 = ema20[ema20.length - 1];
    }
  } catch (error) {
    console.warn('EMA20 계산 실패:', error);
  }

  // EMA50 계산 (50일 이상 필요)
  try {
    if (prices.length >= 50) {
      const ema50 = calculateEMA(prices, 50);
      result.ema50 = ema50[ema50.length - 1];
    }
  } catch (error) {
    console.warn('EMA50 계산 실패:', error);
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * EMA (지수이동평균) 계산
 * EMA_t = α * P_t + (1-α) * EMA_{t-1}
 * α = 2 / (period + 1)
 */
function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) {
    throw new Error(`EMA 계산을 위해 최소 ${period}일 데이터가 필요합니다`);
  }

  const alpha = 2 / (period + 1);
  const ema: number[] = [];
  
  // 첫 번째 EMA는 단순 이동평균으로 시작
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  ema.push(sum / period);

  // 이후 EMA 계산
  for (let i = period; i < prices.length; i++) {
    const currentEMA = alpha * prices[i] + (1 - alpha) * ema[ema.length - 1];
    ema.push(currentEMA);
  }

  return ema;
}

/**
 * RSI (상대강도지수) 계산
 * RSI = 100 - (100 / (1 + RS))
 * RS = 평균 상승 / 평균 하락
 */
function calculateRSI(prices: number[], period: number = 14): number[] {
  if (prices.length <= period) {
    throw new Error(`RSI 계산을 위해 최소 ${period + 1}일 데이터가 필요합니다`);
  }

  const rsi: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  // 일간 변화량 계산
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }

  // 첫 번째 평균 상승/하락 계산
  let avgGain = gains.slice(0, period).reduce((sum, gain) => sum + gain, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((sum, loss) => sum + loss, 0) / period;

  // 첫 번째 RSI 계산
  let rs = avgGain / (avgLoss || 1); // 0으로 나누기 방지
  rsi.push(100 - (100 / (1 + rs)));

  // 이후 RSI 계산 (Wilder's smoothing 사용)
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    
    rs = avgGain / (avgLoss || 1);
    rsi.push(100 - (100 / (1 + rs)));
  }

  return rsi;
}

/**
 * 주식 데이터 품질 검증
 */
export async function validateStockDataQuality(symbol: string, priceData: PriceData[]): Promise<StockBasicInfo> {
  const result: StockBasicInfo = {
    symbol,
    isActive: true,
    hasMinimumData: false
  };

  // 1. 최소 데이터 길이 검증 (기술지표 계산용)
  if (priceData.length >= 50) {
    result.hasMinimumData = true;
  }

  // 2. 최근 거래량 분석
  if (priceData.length > 0) {
    const recentData = priceData.slice(-20); // 최근 20일
    const avgVolume = recentData.reduce((sum, data) => sum + data.volume, 0) / recentData.length;
    
    // 최소 거래량 조건 (일일 평균 10만주 이상)
    if (avgVolume < 100000) {
      result.isActive = false;
    }
    
    result.avgVolume = avgVolume;
  }

  // 3. 가격 안정성 검증
  if (priceData.length > 0) {
    const recentPrices = priceData.slice(-5).map(d => d.close);
    const avgPrice = recentPrices.reduce((sum, price) => sum + price, 0) / recentPrices.length;
    
    // 최소 주가 조건 ($1 이상)
    if (avgPrice < 1.0) {
      result.isActive = false;
    }

    // 시가총액 추정 (간단히 최근가격 * 대략적인 발행주식수로 계산)
    if (result.avgVolume && avgPrice > 0) {
      // 매우 간단한 시가총액 추정: 평균 거래량 * 100 * 현재가
      const estimatedShares = (result.avgVolume || 0) * 100;
      result.marketCap = estimatedShares * avgPrice;
      
      // 최소 시가총액 조건 ($50M 이상)
      if (result.marketCap < 50_000_000) {
        result.isActive = false;
      }
    }
  }

  return result;
}

/**
 * 종목 리스트에서 품질이 낮은 종목 필터링
 */
export async function filterHighQualityStocks(symbols: string[]): Promise<string[]> {
  const validSymbols: string[] = [];
  
  console.log(`🔍 ${symbols.length}개 종목 데이터 품질 검증 중...`);
  
  for (const symbol of symbols) {
    try {
      // 가격 데이터 조회
      const priceData = await fetchFromToss(symbol);
      
      // 데이터 품질 검증
      const quality = await validateStockDataQuality(symbol, priceData);
      
      if (quality.isActive && quality.hasMinimumData) {
        validSymbols.push(symbol);
      } else {
        console.log(`⚠️ ${symbol}: 품질 기준 미달 (활성: ${quality.isActive}, 데이터: ${quality.hasMinimumData})`);
      }
    } catch (error) {
      console.log(`❌ ${symbol}: 데이터 조회 실패`);
    }
  }
  
  console.log(`✅ ${validSymbols.length}개 고품질 종목 선별 완료`);
  return validSymbols;
}