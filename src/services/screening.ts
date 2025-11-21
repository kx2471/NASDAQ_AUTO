import { db, Symbol } from '../storage/database';
import { SectorConfig } from '../utils/config';
import { StockDiscoveryEngine, DiscoveredStock } from './discovery';
import { filterHighQualityStocks } from './market';

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
}

/**
 * 동적 종목 스크리닝 엔진
 * 발견된 종목들을 분석하여 투자 추천 생성
 */
export class DynamicStockScreener {
  private discoveryEngine: StockDiscoveryEngine;

  constructor() {
    this.discoveryEngine = new StockDiscoveryEngine();
  }

  /**
   * 섹터별 종목 스크리닝 실행
   */
  async screenSector(
    sectorCode: string,
    sectorConfig: SectorConfig
  ): Promise<ScreeningResult[]> {
    console.log(`📊 ${sectorConfig.title} 섹터 스크리닝 시작...`);

    try {
      // 1. 기존 저장된 종목들 조회
      let sectorStocks = await this.getExistingSectorStocks(sectorCode);

      // 2. 저장된 종목이 부족하거나 오래된 경우 새로 발견
      if (sectorStocks.length < Math.min(10, sectorConfig.max_symbols)) {
        console.log(`🔍 ${sectorCode}: 새로운 종목 발견 시작 (현재 ${sectorStocks.length}개)`);
        
        const discoveredStocks = await this.discoveryEngine.discoverStocksForSector(
          sectorCode, 
          sectorConfig
        );
        
        await this.discoveryEngine.saveDiscoveredStocks(discoveredStocks);
        sectorStocks = await this.getExistingSectorStocks(sectorCode);
      }

      // 3. 품질 필터링 적용 - 활성 종목만 선별
      const activeStocks = sectorStocks.filter(stock => stock.active);
      console.log(`📊 ${sectorCode}: 활성 종목 ${activeStocks.length}개 / 전체 ${sectorStocks.length}개`);
      
      // 4. 높은 품질의 종목들만 추가 검증
      const symbolsToVerify = activeStocks.map(stock => stock.symbol);
      let verifiedSymbols: string[] = [];
      
      if (symbolsToVerify.length > 0) {
        console.log(`🔍 ${sectorCode}: ${symbolsToVerify.length}개 종목 품질 재검증 중...`);
        verifiedSymbols = await filterHighQualityStocks(symbolsToVerify);
        console.log(`✅ ${sectorCode}: ${verifiedSymbols.length}개 고품질 종목 확인`);
      }
      
      // 5. 검증된 종목들만 분석 대상으로 선정
      const qualifiedStocks = activeStocks.filter(stock => 
        verifiedSymbols.includes(stock.symbol)
      );
      
      // 6. 각 종목에 대한 상세 분석
      const screeningResults: ScreeningResult[] = [];
      
      for (const stock of qualifiedStocks.slice(0, sectorConfig.max_symbols)) {
        try {
          const result = await this.analyzeStock(stock, sectorCode, sectorConfig);
          if (result) {
            screeningResults.push(result);
          }
        } catch (error) {
          console.warn(`⚠️ ${stock.symbol} 분석 실패:`, error);
        }
      }

      // 7. 결과 정렬 및 필터링
      const filteredResults = screeningResults
        .filter(result => result.overall_score >= 0.3) // 최소 점수 필터
        .sort((a, b) => b.overall_score - a.overall_score);

      console.log(`✅ ${sectorConfig.title} 스크리닝 완료: ${filteredResults.length}개 종목 (품질 필터링 적용)`);
      return filteredResults;

    } catch (error) {
      console.error(`❌ ${sectorCode} 스크리닝 실패:`, error);
      return [];
    }
  }

  /**
   * 섹터의 기존 종목들 조회
   */
  private async getExistingSectorStocks(sectorCode: string): Promise<Symbol[]> {
    const allSymbols = await db.find<Symbol>('symbols');
    return allSymbols.filter(symbol => 
      symbol.sector === sectorCode && symbol.active
    );
  }

  /**
   * 개별 종목 분석
   */
  private async analyzeStock(
    stock: Symbol,
    sectorCode: string,
    sectorConfig: SectorConfig
  ): Promise<ScreeningResult | null> {
    try {
      // 1. 가격 모멘텀 분석
      const momentumScore = await this.calculateMomentumScore(stock.symbol);

      // 2. 뉴스 감성 분석
      const newsSentiment = await this.calculateNewsSentiment(stock.symbol, sectorConfig);

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
      // ✅ 실시간 가격 데이터 조회
      const { fetchDailyPrices } = await import('./market');
      const { getHistoricalPrices, isRealtimePriceEnabled } = await import('./realtime-market');

      let prices: any[] = [];

      // 1차: Yahoo Finance 조회
      try {
        const pricesData = await fetchDailyPrices([symbol]);
        prices = pricesData[symbol] || [];
      } catch (error) {
        console.warn(`⚠️ ${symbol} Yahoo Finance 조회 실패`);
      }

      // 2차: Alpaca fallback (데이터 부족 시)
      if (prices.length < 20 && isRealtimePriceEnabled()) {
        try {
          console.log(`🔄 ${symbol} Alpaca 데이터로 보완 중...`);
          prices = await getHistoricalPrices(symbol, 100);
        } catch (error) {
          console.warn(`⚠️ ${symbol} Alpaca 조회 실패`);
        }
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
  private async calculateNewsSentiment(
    symbol: string,
    sectorConfig: SectorConfig
  ): Promise<number> {
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
      // ✅ 실시간 가격 데이터로 기술지표 계산
      const { fetchDailyPrices, computeIndicators, computeIndicatorsPartial } = await import('./market');
      const { getHistoricalPrices, isRealtimePriceEnabled } = await import('./realtime-market');

      let prices: any[] = [];

      // 1차: Yahoo Finance 조회
      try {
        const pricesData = await fetchDailyPrices([symbol]);
        prices = pricesData[symbol] || [];
      } catch (error) {
        console.warn(`⚠️ ${symbol} Yahoo Finance 조회 실패`);
      }

      // 2차: Alpaca fallback (데이터 부족 시)
      if (prices.length < 50 && isRealtimePriceEnabled()) {
        try {
          console.log(`🔄 ${symbol} Alpaca 기술지표 데이터 보완 중...`);
          prices = await getHistoricalPrices(symbol, 100);
        } catch (error) {
          console.warn(`⚠️ ${symbol} Alpaca 조회 실패`);
        }
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
    // 강한 매수 신호
    if (overallScore >= 0.7 && momentumScore >= 0.6 && newsSentiment >= 0.1) {
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

/**
 * 전체 섹터 스크리닝 실행
 */
export async function runFullScreening(
  sectors: Record<string, SectorConfig>
): Promise<Record<string, ScreeningResult[]>> {
  const screener = new DynamicStockScreener();
  const results: Record<string, ScreeningResult[]> = {};

  for (const [sectorCode, sectorConfig] of Object.entries(sectors)) {
    try {
      console.log(`\n🔄 ${sectorConfig.title} 섹터 스크리닝 시작...`);
      
      const sectorResults = await screener.screenSector(sectorCode, sectorConfig);
      results[sectorCode] = sectorResults;

      console.log(`📊 ${sectorConfig.title}: ${sectorResults.length}개 종목 분석 완료`);
      
      // API 호출 제한 준수
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.error(`❌ ${sectorCode} 스크리닝 실패:`, error);
      results[sectorCode] = [];
    }
  }

  return results;
}