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
   * 가격 모멘텀 점수 계산
   */
  private async calculateMomentumScore(symbol: string): Promise<number> {
    try {
      // 최근 가격 데이터 조회
      const prices = await db.find<any>('prices_daily', 
        (price: any) => price.symbol === symbol
      );

      if (prices.length < 20) {
        return 0.5; // 데이터 부족시 중립 점수
      }

      // 최근 20일 정렬
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

      return momentumScore;

    } catch (error) {
      console.warn(`모멘텀 계산 실패 (${symbol}):`, error);
      return 0.5;
    }
  }

  /**
   * 뉴스 감성 점수 계산
   */
  private async calculateNewsSentiment(
    symbol: string, 
    sectorConfig: SectorConfig
  ): Promise<number> {
    try {
      // 최근 뉴스 조회 (종목별 + 섹터별)
      const news = await db.find<any>('news', (newsItem: any) => {
        const isRecentNews = new Date(newsItem.published_at) > 
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 최근 7일

        return isRecentNews && (
          newsItem.symbol === symbol || 
          sectorConfig.keywords.some(keyword => 
            newsItem.title?.toLowerCase().includes(keyword.toLowerCase()) ||
            newsItem.summary?.toLowerCase().includes(keyword.toLowerCase())
          )
        );
      });

      if (news.length === 0) {
        return 0; // 뉴스가 없으면 중립
      }

      // 가중 평균 감성 점수 (최근 뉴스에 더 높은 가중치)
      let totalSentiment = 0;
      let totalWeight = 0;

      for (const newsItem of news) {
        const daysAgo = Math.floor(
          (Date.now() - new Date(newsItem.published_at).getTime()) / 
          (1000 * 60 * 60 * 24)
        );
        
        // 최근 뉴스일수록 높은 가중치
        const weight = Math.max(0.1, 1 / (1 + daysAgo * 0.2));
        
        totalSentiment += (newsItem.sentiment || 0) * weight;
        totalWeight += weight;
      }

      return totalWeight > 0 ? totalSentiment / totalWeight : 0;

    } catch (error) {
      console.warn(`뉴스 감성 계산 실패 (${symbol}):`, error);
      return 0;
    }
  }

  /**
   * 기술적 분석 점수 계산
   */
  private async calculateTechnicalScore(symbol: string): Promise<number> {
    try {
      // 최신 기술지표 조회
      const indicators = await db.find<any>('indicators_daily', 
        (indicator: any) => indicator.symbol === symbol
      );

      if (indicators.length === 0) {
        return 0.5; // 지표 데이터 없으면 중립
      }

      // 최신 지표 데이터
      const latestIndicator = indicators
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

      let score = 0.5; // 기본 중립 점수

      // EMA 교차 신호
      if (latestIndicator.ema_20 && latestIndicator.ema_50) {
        if (latestIndicator.ema_20 > latestIndicator.ema_50) {
          score += 0.2; // 상승 추세
        } else {
          score -= 0.2; // 하락 추세
        }
      }

      // RSI 신호
      if (latestIndicator.rsi_14) {
        const rsi = latestIndicator.rsi_14;
        if (rsi < 35) {
          score += 0.2; // 과매도
        } else if (rsi > 70) {
          score -= 0.3; // 과매수
        }
      }

      return Math.max(0, Math.min(1, score));

    } catch (error) {
      console.warn(`기술적 분석 실패 (${symbol}):`, error);
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