import axios from 'axios';

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
 * 일일 가격 데이터 수집
 * 여러 데이터 공급자를 지원 (Alpha Vantage, Finnhub 등)
 */
export async function fetchDailyPrices(symbols: string[]): Promise<Record<string, PriceData[]>> {
  const results: Record<string, PriceData[]> = {};

  for (const symbol of symbols) {
    try {
      // Alpha Vantage API 사용 (기본값)
      if (process.env.ALPHAVANTAGE_API_KEY) {
        const data = await fetchFromAlphaVantage(symbol);
        results[symbol] = data;
      }
      // TODO: 다른 공급자 추가 (Finnhub, Yahoo Finance 등)
      else {
        console.warn(`⚠️ ${symbol}: 가격 데이터 공급자 설정이 없습니다`);
        results[symbol] = [];
      }
    } catch (error) {
      console.error(`❌ ${symbol} 가격 데이터 수집 실패:`, error);
      results[symbol] = [];
    }
  }

  return results;
}

/**
 * Alpha Vantage에서 가격 데이터 수집
 */
async function fetchFromAlphaVantage(symbol: string): Promise<PriceData[]> {
  const url = 'https://www.alphavantage.co/query';
  const params = {
    function: 'TIME_SERIES_DAILY',
    symbol: symbol,
    apikey: process.env.ALPHAVANTAGE_API_KEY,
    outputsize: 'compact' // 최근 100일
  };

  const response = await axios.get(url, { params });
  const data = response.data;

  if (data['Error Message']) {
    throw new Error(`Alpha Vantage 오류: ${data['Error Message']}`);
  }

  if (data['Note']) {
    throw new Error('API 호출 한도 초과');
  }

  const timeSeries = data['Time Series (Daily)'];
  if (!timeSeries) {
    throw new Error('시계열 데이터를 찾을 수 없습니다');
  }

  // 데이터 변환
  const priceData: PriceData[] = [];
  for (const [date, values] of Object.entries(timeSeries)) {
    const dayData = values as any;
    priceData.push({
      date,
      open: parseFloat(dayData['1. open']),
      high: parseFloat(dayData['2. high']),
      low: parseFloat(dayData['3. low']),
      close: parseFloat(dayData['4. close']),
      volume: parseInt(dayData['5. volume'])
    });
  }

  // 날짜 오름차순 정렬
  priceData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return priceData;
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