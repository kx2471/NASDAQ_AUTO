import axios from 'axios';
import { db, Symbol } from '../storage/database';

/**
 * 종목 발견 인터페이스
 */
export interface DiscoveredStock {
  symbol: string;
  name: string;
  exchange: string;
  industry: string;
  market_cap: number;
  description: string;
  sector_code?: string;
  relevance_score: number; // 0-1 점수 (키워드 매칭도)
}

/**
 * 섹터 설정 인터페이스
 */
export interface SectorConfig {
  title: string;
  description: string;
  keywords: string[];
  industries: string[];
  market_cap_min: number;
  max_symbols: number;
}

/**
 * 키워드 기반 종목 발견 엔진
 * 여러 데이터 소스에서 섹터별 관련 종목들을 자동으로 발견
 */
export class StockDiscoveryEngine {
  
  /**
   * 섹터별 종목 발견 및 스크리닝
   */
  async discoverStocksForSector(
    sectorCode: string, 
    sectorConfig: SectorConfig
  ): Promise<DiscoveredStock[]> {
    console.log(`🔍 ${sectorConfig.title} 섹터 종목 검색 시작...`);
    
    const discoveredStocks: DiscoveredStock[] = [];
    
    try {
      // 1. 업종별 종목 검색
      const industryStocks = await this.searchByIndustries(sectorConfig);
      discoveredStocks.push(...industryStocks);
      
      // 2. 키워드 기반 검색 (뉴스/설명 분석)
      const keywordStocks = await this.searchByKeywords(sectorConfig);
      discoveredStocks.push(...keywordStocks);
      
      // 3. 중복 제거 및 관련성 점수 계산
      const uniqueStocks = this.removeDuplicatesAndScore(
        discoveredStocks, 
        sectorConfig,
        sectorCode
      );
      
      // 4. 필터링 및 정렬
      const filteredStocks = this.filterAndRank(uniqueStocks, sectorConfig);
      
      console.log(`✅ ${sectorConfig.title} 섹터: ${filteredStocks.length}개 종목 발견`);
      return filteredStocks.slice(0, sectorConfig.max_symbols);
      
    } catch (error) {
      console.error(`❌ ${sectorCode} 종목 발견 실패:`, error);
      return [];
    }
  }
  
  /**
   * 업종 기반 종목 검색
   * Alpha Vantage나 다른 API를 통해 특정 업종의 종목들을 가져옴
   */
  private async searchByIndustries(config: SectorConfig): Promise<DiscoveredStock[]> {
    const stocks: DiscoveredStock[] = [];
    
    // Alpha Vantage 상장 종목 목록 API 사용
    if (process.env.ALPHAVANTAGE_API_KEY) {
      try {
        const response = await axios.get('https://www.alphavantage.co/query', {
          params: {
            function: 'LISTING_STATUS',
            apikey: process.env.ALPHAVANTAGE_API_KEY
          }
        });
        
        if (response.data) {
          const csvData = response.data;
          const lines = csvData.split('\n');
          
          // 다양한 종목을 위해 전체 데이터에서 샘플링
          const totalLines = lines.length - 1; // 헤더 제외
          const maxSamples = 5000; // 최대 5000개 샘플
          const skipInterval = Math.max(1, Math.floor(totalLines / maxSamples));
          
          for (let i = 1; i < lines.length; i += skipInterval) { // 균등 샘플링
            try {
              const row = this.parseCSVRow(lines[i]);
              if (row && row.length >= 3) {
                const symbol = row[0]?.trim();
                const name = row[1]?.trim();
                const exchange = row[2]?.trim();
                
                // NASDAQ 종목만 필터링
                if (exchange === 'NASDAQ' && symbol && name) {
                  // 업종 매칭은 나중에 추가 API 호출로 확인
                  stocks.push({
                    symbol,
                    name,
                    exchange,
                    industry: 'Unknown',
                    market_cap: 0,
                    description: name,
                    relevance_score: 0.5 // 기본 점수
                  });
                }
              }
            } catch (parseError) {
              console.warn(`CSV 라인 파싱 실패 (라인 ${i}):`, parseError);
            }
          }
        }
        
        // API 호출 제한 준수
        await this.delay(12000); // Alpha Vantage는 5 calls/min
        
      } catch (error) {
        console.warn('업종별 검색 실패:', error);
      }
    }
    
    return stocks;
  }
  
  /**
   * 키워드 기반 종목 검색
   * 뉴스 API나 종목 설명에서 키워드 매칭으로 관련 종목 발견
   */
  private async searchByKeywords(config: SectorConfig): Promise<DiscoveredStock[]> {
    const stocks: DiscoveredStock[] = [];
    
    // NewsAPI를 통한 키워드 기반 종목 발견
    if (process.env.NEWSAPI_API_KEY) {
      try {
        for (const keyword of config.keywords.slice(0, 3)) { // 처음 3개 키워드만
          const response = await axios.get('https://newsapi.org/v2/everything', {
            params: {
              q: `${keyword} stock nasdaq`,
              apiKey: process.env.NEWSAPI_API_KEY,
              language: 'en',
              sortBy: 'popularity',
              pageSize: 20,
              domains: 'reuters.com,bloomberg.com,cnbc.com,marketwatch.com'
            }
          });
          
          if (response.data.articles) {
            const extractedStocks = this.extractStockSymbolsFromNews(
              response.data.articles, 
              keyword
            );
            stocks.push(...extractedStocks);
          }
          
          await this.delay(1000); // NewsAPI 호출 제한 준수
        }
      } catch (error) {
        console.warn('키워드 검색 실패:', error);
      }
    }
    
    return stocks;
  }
  
  /**
   * 뉴스에서 종목 심볼 추출
   */
  private extractStockSymbolsFromNews(articles: any[], keyword: string): DiscoveredStock[] {
    const stocks: DiscoveredStock[] = [];
    const symbolPattern = /\b([A-Z]{2,5})\b/g; // 2-5자리 대문자 (종목 심볼 패턴)
    
    for (const article of articles) {
      const content = `${article.title} ${article.description || ''}`;
      const matches = content.match(symbolPattern);
      
      if (matches) {
        for (const symbol of matches) {
          // 일반적인 종목 심볼 패턴 확인
          if (this.isLikelyStockSymbol(symbol)) {
            stocks.push({
              symbol,
              name: `${symbol} Corp`, // 임시 이름
              exchange: 'NASDAQ',
              industry: 'Unknown',
              market_cap: 0,
              description: article.title,
              relevance_score: 0.7
            });
          }
        }
      }
    }
    
    return stocks;
  }
  
  /**
   * 종목 심볼인지 확인하는 휴리스틱
   */
  private isLikelyStockSymbol(text: string): boolean {
    const excludeWords = [
      'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HAD', 
      'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'GET', 'HAS', 'HIM', 'HIS', 
      'HOW', 'ITS', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WHO', 'BOY', 'DID',
      'CEO', 'CFO', 'SEC', 'NYSE', 'IPO', 'ETF', 'API', 'AI', 'ML', 'IT'
    ];
    
    return text.length >= 2 && 
           text.length <= 5 && 
           !excludeWords.includes(text) &&
           /^[A-Z]+$/.test(text);
  }
  
  /**
   * 중복 제거 및 관련성 점수 계산
   */
  private removeDuplicatesAndScore(
    stocks: DiscoveredStock[], 
    config: SectorConfig,
    sectorCode: string
  ): DiscoveredStock[] {
    const uniqueMap = new Map<string, DiscoveredStock>();
    
    for (const stock of stocks) {
      const existing = uniqueMap.get(stock.symbol);
      
      if (!existing || stock.relevance_score > existing.relevance_score) {
        // 키워드 매칭으로 관련성 점수 재계산
        const relevanceScore = this.calculateRelevanceScore(stock, config);
        
        uniqueMap.set(stock.symbol, {
          ...stock,
          sector_code: sectorCode,
          relevance_score: relevanceScore
        });
      }
    }
    
    return Array.from(uniqueMap.values());
  }
  
  /**
   * 키워드 기반 관련성 점수 계산
   */
  private calculateRelevanceScore(stock: DiscoveredStock, config: SectorConfig): number {
    let score = stock.relevance_score || 0;
    const text = `${stock.name} ${stock.description}`.toLowerCase();
    
    // 키워드 매칭 점수
    let keywordMatches = 0;
    for (const keyword of config.keywords) {
      if (text.includes(keyword.toLowerCase())) {
        keywordMatches++;
        score += 0.1;
      }
    }
    
    // 키워드 매칭 비율 보너스
    const keywordRatio = keywordMatches / config.keywords.length;
    score += keywordRatio * 0.3;
    
    return Math.min(1.0, score);
  }
  
  /**
   * 필터링 및 순위 매기기
   */
  private filterAndRank(stocks: DiscoveredStock[], config: SectorConfig): DiscoveredStock[] {
    return stocks
      .filter(stock => {
        // 시가총액 필터 (현재는 0으로 설정되어 있어 나중에 실제 데이터로 보완)
        // return stock.market_cap >= config.market_cap_min;
        return true; // 임시로 모든 종목 허용
      })
      .filter(stock => stock.relevance_score >= 0.3) // 최소 관련성 점수
      .sort((a, b) => b.relevance_score - a.relevance_score); // 관련성 순 정렬
  }
  
  /**
   * 발견된 종목들을 데이터베이스에 저장
   */
  async saveDiscoveredStocks(stocks: DiscoveredStock[]): Promise<void> {
    for (const stock of stocks) {
      const symbolData: Symbol = {
        symbol: stock.symbol,
        name: stock.name,
        exchange: stock.exchange,
        sector: stock.sector_code || 'unknown',
        industry: stock.industry,
        active: true
      };
      
      // UPSERT: 이미 존재하면 업데이트, 없으면 추가
      await db.upsert('symbols', symbolData, 'symbol');
    }
    
    console.log(`💾 ${stocks.length}개 종목을 데이터베이스에 저장 완료`);
  }
  
  /**
   * CSV 행 파싱 함수 (쉼표가 포함된 필드 처리)
   */
  private parseCSVRow(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // 이스케이프된 따옴표 ("") 처리
          current += '"';
          i++; // 다음 따옴표 건너뛰기
        } else {
          // 따옴표 시작/끝
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // 따옴표 밖의 쉼표 = 필드 구분자
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // 마지막 필드 추가
    result.push(current.trim());
    
    // 따옴표 제거
    return result.map(field => field.replace(/^"(.+)"$/, '$1'));
  }

  /**
   * 지연 함수 (API 호출 제한 준수)
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 전체 섹터에 대한 종목 발견 실행
 */
export async function discoverAllSectorStocks(sectors: Record<string, SectorConfig>): Promise<void> {
  const engine = new StockDiscoveryEngine();
  
  for (const [sectorCode, sectorConfig] of Object.entries(sectors)) {
    try {
      const discoveredStocks = await engine.discoverStocksForSector(sectorCode, sectorConfig);
      await engine.saveDiscoveredStocks(discoveredStocks);
      
      // 섹터 간 API 호출 제한 준수
      await new Promise(resolve => setTimeout(resolve, 5000));
      
    } catch (error) {
      console.error(`❌ ${sectorCode} 섹터 종목 발견 실패:`, error);
    }
  }
}