import { getUniverse, UniverseStock } from './universe';
import { getPrices, getCandles, TossCandle } from './toss';

/**
 * 종목 스크리닝 결과 인터페이스
 */
export interface ScreeningResult {
  symbol: string;
  name: string;
  sector_code: string;
  current_price?: number;
  market_cap?: number;
  volume_avg?: number;
  momentum_score: number;    // 가격 모멘텀 (0-1)
  news_sentiment: number;    // 뉴스 감성 (-1 ~ +1)
  technical_score: number;   // 기술적 점수 (0-1)
  overall_score: number;     // 종합 점수 (0-1)
  recommendation: 'BUY' | 'HOLD' | 'SELL';
  reason: string;
  avg_dollar_volume?: number; // 20일 평균 거래대금 (USD) — 유동성/거래가능성 판단용
}

/**
 * 종목 스크리닝 엔진
 * 선별된 후보 종목을 정밀 분석하여 투자 추천 생성
 */
export class DynamicStockScreener {

  /**
   * 개별 종목 정밀 분석 (100일 기술지표 + 뉴스 감성 + 모멘텀)
   * @param stock       분석 대상 (symbol/name)
   * @param sectorCode  결과에 표기할 시장/섹터 라벨
   */
  async analyzeStock(
    stock: { symbol: string; name: string },
    sectorCode: string
  ): Promise<ScreeningResult | null> {
    try {
      // 1. 가격 모멘텀 분석
      const momentumScore = await this.calculateMomentumScore(stock.symbol);

      // 2. 뉴스 감성 분석
      const newsSentiment = await this.calculateNewsSentiment(stock.symbol);

      // 3. 기술적 분석 점수
      const technicalScore = await this.calculateTechnicalScore(stock.symbol);

      // 4. 종합 점수 계산
      const overallScore = this.calculateOverallScore(
        momentumScore,
        newsSentiment,
        technicalScore
      );

      // 5. 투자 추천 결정
      const recommendation = this.determineRecommendation(
        overallScore,
        momentumScore,
        newsSentiment,
        technicalScore
      );

      // 6. 추천 이유 생성
      const reason = this.generateRecommendationReason(
        recommendation,
        momentumScore,
        newsSentiment,
        technicalScore
      );

      return {
        symbol: stock.symbol,
        name: stock.name,
        sector_code: sectorCode,
        momentum_score: momentumScore,
        news_sentiment: newsSentiment,
        technical_score: technicalScore,
        overall_score: overallScore,
        recommendation,
        reason
      };

    } catch (error) {
      console.warn(`⚠️ ${stock.symbol} 분석 중 오류:`, error);
      return null;
    }
  }

  /**
   * 가격 모멘텀 점수 계산 (실시간 데이터)
   */
  private async calculateMomentumScore(symbol: string): Promise<number> {
    try {
      // ✅ 토스 일봉 데이터 조회 (fetchDailyPrices와 getHistoricalPrices는 동일 소스이므로 폴백 불필요)
      const { fetchDailyPrices } = await import('./market');

      let prices: any[] = [];
      try {
        const pricesData = await fetchDailyPrices([symbol]);
        prices = pricesData[symbol] || [];
      } catch (error) {
        console.warn(`⚠️ ${symbol} 토스 일봉 조회 실패`);
      }

      if (prices.length < 20) {
        console.warn(`⚠️ ${symbol} 데이터 부족 (${prices.length}일) - 중립 점수 반환`);
        return 0.5; // 데이터 부족시 중립 점수
      }

      // 최근 20일 정렬 (날짜 내림차순)
      const recentPrices = prices
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 20);

      if (recentPrices.length < 5) {
        return 0.5;
      }

      const latestPrice = recentPrices[0].close;
      const price5DaysAgo = recentPrices[4].close;
      const price20DaysAgo = recentPrices[recentPrices.length - 1].close;

      // 단기 모멘텀 (5일)
      const shortTermMomentum = (latestPrice - price5DaysAgo) / price5DaysAgo;

      // 장기 모멘텀 (20일)
      const longTermMomentum = (latestPrice - price20DaysAgo) / price20DaysAgo;

      // 모멘텀 점수 계산 (0-1 범위로 정규화)
      const momentumScore = Math.max(0, Math.min(1,
        0.5 + (shortTermMomentum * 2) + (longTermMomentum * 1)
      ));

      console.log(`💹 ${symbol} 모멘텀: ${(momentumScore * 100).toFixed(1)}% (5일: ${(shortTermMomentum * 100).toFixed(1)}%, 20일: ${(longTermMomentum * 100).toFixed(1)}%)`);
      return momentumScore;

    } catch (error) {
      console.warn(`❌ ${symbol} 모멘텀 계산 실패:`, error);
      return 0.5;
    }
  }

  /**
   * 뉴스 감성 점수 계산 (실시간 뉴스 조회)
   */
  private async calculateNewsSentiment(symbol: string): Promise<number> {
    try {
      // ✅ 실시간 뉴스 조회
      const { fetchNews } = await import('./news');

      let allNews: any[] = [];

      // 종목별 실시간 뉴스 조회 (최근 7일)
      try {
        const symbolNews = await fetchNews({
          symbols: [symbol],
          limit: 15, // 충분한 뉴스 수집
          fromDate: this.getDateDaysAgo(7)
        });
        allNews = allNews.concat(symbolNews);
        console.log(`   📰 ${symbol}: ${symbolNews.length}건 수집`);
      } catch (error) {
        console.warn(`⚠️ ${symbol} 종목 뉴스 조회 실패:`, error);
      }

      // 중복 제거 (URL 기준)
      const uniqueNews = Array.from(
        new Map(allNews.map(news => [news.url || news.title, news])).values()
      );

      if (uniqueNews.length === 0) {
        console.log(`ℹ️ ${symbol} 뉴스 없음 - 중립 점수`);
        return 0; // 뉴스가 없으면 중립
      }

      // 가중 평균 감성 점수 (최근 뉴스에 더 높은 가중치)
      let totalSentiment = 0;
      let totalWeight = 0;
      let positiveCount = 0;
      let negativeCount = 0;

      for (const newsItem of uniqueNews) {
        const publishedDate = new Date(newsItem.published_at || newsItem.publishedAt);
        const daysAgo = Math.floor(
          (Date.now() - publishedDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        // 최근 뉴스일수록 높은 가중치
        const weight = Math.max(0.1, 1 / (1 + daysAgo * 0.2));

        const sentiment = newsItem.sentiment || 0;
        totalSentiment += sentiment * weight;
        totalWeight += weight;

        if (sentiment > 0.1) positiveCount++;
        if (sentiment < -0.1) negativeCount++;
      }

      const avgSentiment = totalWeight > 0 ? totalSentiment / totalWeight : 0;

      console.log(`📰 ${symbol} 뉴스: ${uniqueNews.length}건 (긍정 ${positiveCount}, 부정 ${negativeCount}, 감성 ${avgSentiment.toFixed(2)})`);
      return avgSentiment;

    } catch (error) {
      console.warn(`❌ ${symbol} 뉴스 감성 계산 실패:`, error);
      return 0;
    }
  }

  /**
   * N일 전 날짜 반환 (YYYY-MM-DD)
   */
  private getDateDaysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }

  /**
   * 기술적 분석 점수 계산 (실시간 기술지표)
   */
  private async calculateTechnicalScore(symbol: string): Promise<number> {
    try {
      // ✅ 토스 일봉 데이터로 기술지표 계산 (동일 소스이므로 2차 폴백 불필요)
      const { fetchDailyPrices, computeIndicators, computeIndicatorsPartial } = await import('./market');

      let prices: any[] = [];
      try {
        const pricesData = await fetchDailyPrices([symbol]);
        prices = pricesData[symbol] || [];
      } catch (error) {
        console.warn(`⚠️ ${symbol} 토스 일봉 조회 실패`);
      }

      if (prices.length < 15) {
        console.warn(`⚠️ ${symbol} 기술지표 데이터 부족 (${prices.length}일) - 중립 점수`);
        return 0.5; // 데이터 부족시 중립
      }

      const closePrices = prices.map(p => p.close);
      let ema20: number | undefined;
      let ema50: number | undefined;
      let rsi14: number | undefined;
      let currentPrice = closePrices[closePrices.length - 1];

      // 기술지표 계산
      if (prices.length >= 50) {
        const indicators = computeIndicators(closePrices);
        ema20 = indicators.ema20;
        ema50 = indicators.ema50;
        rsi14 = indicators.rsi14;
      } else if (prices.length >= 15) {
        const indicators = computeIndicatorsPartial(closePrices);
        ema20 = indicators?.ema20;
        ema50 = indicators?.ema50;
        rsi14 = indicators?.rsi14;
      }

      let score = 0.5; // 기본 중립 점수

      // EMA 교차 신호
      if (ema20 && ema50) {
        const emaDiff = (ema20 - ema50) / ema50;
        if (ema20 > ema50) {
          score += 0.2; // 상승 추세
        } else {
          score -= 0.2; // 하락 추세
        }

        // 현재가와 EMA 관계
        if (currentPrice > ema20 && currentPrice > ema50) {
          score += 0.1; // 강한 상승
        } else if (currentPrice < ema20 && currentPrice < ema50) {
          score -= 0.1; // 강한 하락
        }
      }

      // RSI 신호
      if (rsi14) {
        if (rsi14 < 30) {
          score += 0.3; // 강한 과매도 (반등 기회)
        } else if (rsi14 < 35) {
          score += 0.2; // 과매도
        } else if (rsi14 > 70) {
          score -= 0.3; // 과매수 (조정 가능)
        } else if (rsi14 > 65) {
          score -= 0.1; // 약한 과매수
        }
      }

      const finalScore = Math.max(0, Math.min(1, score));

      console.log(`📊 ${symbol} 기술: EMA20=${ema20?.toFixed(2)}, EMA50=${ema50?.toFixed(2)}, RSI=${rsi14?.toFixed(1)}, 점수=${(finalScore * 100).toFixed(1)}%`);
      return finalScore;

    } catch (error) {
      console.warn(`❌ ${symbol} 기술적 분석 실패:`, error);
      return 0.5;
    }
  }

  /**
   * 종합 점수 계산
   */
  private calculateOverallScore(
    momentumScore: number,
    newsSentiment: number,
    technicalScore: number
  ): number {
    // 가중 평균 (모멘텀 40%, 뉴스 30%, 기술적 30%)
    const weights = {
      momentum: 0.4,
      news: 0.3,
      technical: 0.3
    };

    // 뉴스 감성을 0-1 범위로 정규화
    const normalizedSentiment = Math.max(0, Math.min(1, (newsSentiment + 1) / 2));

    const overallScore = 
      (momentumScore * weights.momentum) +
      (normalizedSentiment * weights.news) +
      (technicalScore * weights.technical);

    return Math.round(overallScore * 100) / 100; // 소수점 2자리
  }

  /**
   * 투자 추천 결정
   */
  private determineRecommendation(
    overallScore: number,
    momentumScore: number,
    newsSentiment: number,
    technicalScore: number
  ): 'BUY' | 'HOLD' | 'SELL' {
    // 강한 매수 신호 — 뉴스는 부정적이지만 않으면 허용 (뉴스 없음=중립 0이 BUY를 막지 않도록)
    if (overallScore >= 0.7 && momentumScore >= 0.6 && newsSentiment >= 0) {
      return 'BUY';
    }

    // 준매수 신호 — 종합점수와 기술적 신호가 모두 강하면 모멘텀 기준 완화
    if (overallScore >= 0.65 && technicalScore >= 0.7 && newsSentiment >= 0) {
      return 'BUY';
    }

    // 매도 신호
    if (overallScore <= 0.3 || (momentumScore <= 0.3 && newsSentiment <= -0.2)) {
      return 'SELL';
    }

    // 나머지는 보유
    return 'HOLD';
  }

  /**
   * 추천 이유 생성
   */
  private generateRecommendationReason(
    recommendation: 'BUY' | 'HOLD' | 'SELL',
    momentumScore: number,
    newsSentiment: number,
    technicalScore: number
  ): string {
    const reasons: string[] = [];

    // 모멘텀 분석
    if (momentumScore >= 0.7) {
      reasons.push('강한 가격 상승세');
    } else if (momentumScore <= 0.3) {
      reasons.push('가격 하락 추세');
    }

    // 뉴스 감성 분석
    if (newsSentiment >= 0.3) {
      reasons.push('긍정적 뉴스 영향');
    } else if (newsSentiment <= -0.3) {
      reasons.push('부정적 뉴스 영향');
    }

    // 기술적 분석
    if (technicalScore >= 0.7) {
      reasons.push('기술적 매수 신호');
    } else if (technicalScore <= 0.3) {
      reasons.push('기술적 매도 신호');
    }

    // 추천별 기본 메시지
    const baseMessage = {
      'BUY': '매수 추천',
      'HOLD': '보유 추천', 
      'SELL': '매도 추천'
    };

    const reasonText = reasons.length > 0 ? 
      ` (${reasons.join(', ')})` : 
      ' (종합 점수 기준)';

    return baseMessage[recommendation] + reasonText;
  }
}

// =============================================================
// 전시장 퍼널 스크리닝
// =============================================================

/** 2단계 모멘텀 스캔 결과 (정밀 분석 후보) */
interface QuickScanResult {
  symbol: string;
  name: string;
  market: string;
  mom5: number;           // 5일 수익률
  mom20: number;          // 20일 수익률
  avgDollarVolume: number; // 20일 평균 거래대금 (USD)
  nearHigh: number;       // 20일 고점 대비 현재가 비율 (0~1)
  quickScore: number;     // 후보 순위용 점수
}

/**
 * 동시성 제한 병렬 실행 (레이트리밋 고려)
 * @param items 처리 대상 배열
 * @param limit 동시 실행 개수
 * @param fn    각 항목 처리 함수 (실패 시 null 반환 권장)
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * 30일 캔들로 빠른 모멘텀/유동성 스캔
 * @returns 통과 시 스캔 결과, 데이터 부족/유동성 미달 시 null
 */
async function quickScan(stock: UniverseStock, minDollarVolume: number): Promise<QuickScanResult | null> {
  try {
    const candles: TossCandle[] = await getCandles(stock.symbol, '1d', 30);
    if (candles.length < 21) return null;

    const closes = candles.map(c => c.close);
    const last = closes[closes.length - 1];
    const close5 = closes[closes.length - 6];
    const close20 = closes[closes.length - 21];
    if (!last || !close5 || !close20) return null;

    const mom5 = (last - close5) / close5;
    const mom20 = (last - close20) / close20;

    // 최근 20일 평균 거래대금 — 유동성 미달 종목은 소액으로도 슬리피지가 커서 제외
    const recent20 = candles.slice(-20);
    const avgDollarVolume = recent20.reduce((s, c) => s + c.volume * c.close, 0) / recent20.length;
    if (avgDollarVolume < minDollarVolume) return null;

    const high20 = Math.max(...recent20.map(c => c.high));
    const nearHigh = high20 > 0 ? last / high20 : 0;

    // 후보 순위 점수: 중기 모멘텀 위주 + 단기 가속 + 고점 근접(추세 지속) 가산
    const quickScore = mom20 * 0.6 + mom5 * 0.4 + (nearHigh - 0.9) * 0.5;

    return {
      symbol: stock.symbol,
      name: stock.name,
      market: stock.market,
      mom5,
      mom20,
      avgDollarVolume,
      nearHigh,
      quickScore
    };
  } catch {
    return null; // 캔들 조회 실패(404 등) — 조용히 제외
  }
}

/**
 * 미국 전시장 퍼널 스크리닝
 *
 * 섹터를 미리 정하지 않고 시장 전체에서 후보를 좁혀 들어간다:
 *  1) 유니버스: 토스 거래가능 미국 보통주 전체 (주 1회 캐시)
 *  2) 시세 일괄조회(200개/콜) → 가격·시총 필터
 *  3) 30일 캔들 모멘텀/유동성 스캔 → 상위 후보 선별
 *  4) 정밀 분석(100일 기술지표 + 뉴스 감성) → 고득점 종목만 추천
 *
 * 환경변수 (기본값):
 *  - SCREEN_MIN_PRICE_USD (3)       : 최소 주가 — 페니스톡 제외
 *  - SCREEN_MIN_MARKET_CAP_USD (5억): 최소 시총
 *  - SCREEN_MIN_DOLLAR_VOLUME (500만): 최소 20일 평균 거래대금
 *  - SCREEN_SCAN_LIMIT (1000)       : 캔들 스캔 대상 수 (시총 상위순)
 *  - SCREEN_FINALISTS (40)          : 정밀 분석 대상 수
 *  - SCREEN_TOP_PICKS (15)          : 최종 추천 상한
 *
 * @returns 기존 소비부 호환 형태 { US_MARKET: ScreeningResult[] } (종합점수 내림차순)
 */
export async function runMarketWideScreening(): Promise<Record<string, ScreeningResult[]>> {
  const minPrice = parseFloat(process.env.SCREEN_MIN_PRICE_USD || '') || 3;
  const minMarketCap = parseFloat(process.env.SCREEN_MIN_MARKET_CAP_USD || '') || 500_000_000;
  const minDollarVolume = parseFloat(process.env.SCREEN_MIN_DOLLAR_VOLUME || '') || 5_000_000;
  const scanLimit = parseInt(process.env.SCREEN_SCAN_LIMIT || '', 10) || 1000;
  const finalistCount = parseInt(process.env.SCREEN_FINALISTS || '', 10) || 40;
  const topPicks = parseInt(process.env.SCREEN_TOP_PICKS || '', 10) || 15;

  // ---- 1단계: 유니버스 ----
  const universe = await getUniverse();
  console.log(`\n🔎 [1/4] 유니버스: ${universe.length}개 종목`);

  // ---- 2단계: 시세 일괄조회 → 가격·시총 필터 ----
  const priceMap = await getPrices(universe.map(u => u.symbol));
  const candidates = universe
    .map(u => ({ ...u, price: priceMap[u.symbol] || 0 }))
    .filter(u => u.price >= minPrice && u.price * u.sharesOutstanding >= minMarketCap)
    .sort((a, b) => b.price * b.sharesOutstanding - a.price * a.sharesOutstanding)
    .slice(0, scanLimit);
  console.log(`🔎 [2/4] 가격 ≥ $${minPrice}·시총 ≥ $${(minMarketCap / 1e6).toFixed(0)}M 필터: ${candidates.length}개 (스캔 상한 ${scanLimit})`);

  // ---- 3단계: 30일 캔들 모멘텀/유동성 스캔 (동시성 4) ----
  const scanned = await mapWithConcurrency(candidates, 4, c => quickScan(c, minDollarVolume));
  const ranked = scanned
    .filter((r): r is QuickScanResult => r !== null && r.mom20 > 0) // 중기 상승 추세만
    .sort((a, b) => b.quickScore - a.quickScore);
  const finalists = ranked.slice(0, finalistCount);
  console.log(`🔎 [3/4] 모멘텀 스캔: ${ranked.length}개 상승추세 확인 → 정밀 분석 대상 ${finalists.length}개`);
  finalists.slice(0, 10).forEach((f, i) =>
    console.log(`   ${i + 1}. ${f.symbol} (20일 ${(f.mom20 * 100).toFixed(1)}%, 5일 ${(f.mom5 * 100).toFixed(1)}%, 거래대금 $${(f.avgDollarVolume / 1e6).toFixed(1)}M)`)
  );

  // ---- 4단계: 정밀 분석 (기존 분석기 재사용) ----
  const screener = new DynamicStockScreener();
  const results: ScreeningResult[] = [];

  for (const finalist of finalists) {
    try {
      const result = await screener.analyzeStock(
        { symbol: finalist.symbol, name: finalist.name },
        finalist.market
      );
      if (result) {
        result.avg_dollar_volume = finalist.avgDollarVolume; // 유동성 전달 (스캔 단계 계산값)
        results.push(result);
      }
    } catch (error) {
      console.warn(`⚠️ ${finalist.symbol} 정밀 분석 실패:`, error);
    }
  }

  // 진짜 오를 것 같은 종목만: 종합점수 상위 + 최소 점수 기준
  const final = results
    .filter(r => r.overall_score >= 0.55)
    .sort((a, b) => b.overall_score - a.overall_score)
    .slice(0, topPicks);

  console.log(`🔎 [4/4] 정밀 분석 완료: ${results.length}개 중 최종 추천 ${final.length}개 (점수 ≥ 0.55)`);
  return { US_MARKET: final };
}