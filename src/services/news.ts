import axios from 'axios';

/**
 * 뉴스 아이템 인터페이스
 */
export interface NewsItem {
  id: string;
  symbol?: string;
  sector_code?: string;
  published_at: string;
  source: string;
  title: string;
  url: string;
  summary: string;
  sentiment: number; // -1 (부정) ~ +1 (긍정)
  relevance: number; // 0 ~ 1 (관련성)
}

/**
 * 뉴스 수집 옵션 인터페이스
 */
export interface NewsOptions {
  symbols?: string[];
  sector?: string;
  limit?: number;
  fromDate?: string;
}

/**
 * 뉴스 데이터 수집
 * 여러 뉴스 공급자를 지원 (Alpha Vantage, NewsAPI 등)
 */
export async function fetchNews(options: NewsOptions): Promise<NewsItem[]> {
  const { symbols = [], sector, limit = 20, fromDate } = options;
  
  try {
    let newsItems: NewsItem[] = [];

    // Alpha Vantage 뉴스 감성 API 사용
    if (process.env.ALPHAVANTAGE_API_KEY) {
      const alphaNews = await fetchFromAlphaVantageNews(symbols, limit);
      newsItems = [...newsItems, ...alphaNews];
    }

    // NewsAPI 사용 (보조)
    if (process.env.NEWSAPI_API_KEY && symbols.length > 0) {
      const newsApiItems = await fetchFromNewsAPI(symbols, limit);
      newsItems = [...newsItems, ...newsApiItems];
    }

    // 중복 제거 (URL 기준)
    const uniqueNews = removeDuplicateNews(newsItems);

    // 관련성 순으로 정렬하고 제한
    return uniqueNews
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);

  } catch (error) {
    console.error('❌ 뉴스 수집 실패:', error);
    return [];
  }
}

/**
 * Alpha Vantage 뉴스 감성 API에서 뉴스 수집
 */
async function fetchFromAlphaVantageNews(symbols: string[], limit: number): Promise<NewsItem[]> {
  const newsItems: NewsItem[] = [];

  for (const symbol of symbols) {
    try {
      const url = 'https://www.alphavantage.co/query';
      const params = {
        function: 'NEWS_SENTIMENT',
        tickers: symbol,
        apikey: process.env.ALPHAVANTAGE_API_KEY,
        limit: Math.min(limit, 50),
        sort: 'LATEST'
      };

      const response = await axios.get(url, { params });
      const data = response.data;

      if (data['Error Message']) {
        throw new Error(`Alpha Vantage 뉴스 오류: ${data['Error Message']}`);
      }

      const feed = data.feed || [];

      for (const item of feed) {
        // 해당 심볼의 감성 점수 찾기
        const tickerSentiment = item.ticker_sentiment?.find((t: any) => 
          t.ticker === symbol
        );

        if (tickerSentiment) {
          newsItems.push({
            id: `av_${item.url.split('/').pop()}`,
            symbol: symbol,
            published_at: item.time_published,
            source: item.source,
            title: item.title,
            url: item.url,
            summary: item.summary || item.title,
            sentiment: parseFloat(tickerSentiment.ticker_sentiment_score || '0'),
            relevance: parseFloat(tickerSentiment.relevance_score || '0')
          });
        }
      }

      // API 호출 제한을 위한 지연
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`❌ ${symbol} Alpha Vantage 뉴스 수집 실패:`, error);
    }
  }

  return newsItems;
}

/**
 * NewsAPI에서 뉴스 수집
 */
async function fetchFromNewsAPI(symbols: string[], limit: number): Promise<NewsItem[]> {
  try {
    const query = symbols.join(' OR ');
    const url = 'https://newsapi.org/v2/everything';
    const params = {
      q: query,
      apiKey: process.env.NEWSAPI_API_KEY,
      language: 'en',
      sortBy: 'publishedAt',
      pageSize: Math.min(limit, 50),
      domains: 'reuters.com,bloomberg.com,cnbc.com,marketwatch.com'
    };

    const response = await axios.get(url, { params });
    const data = response.data;

    if (data.status !== 'ok') {
      throw new Error(`NewsAPI 오류: ${data.message}`);
    }

    const newsItems: NewsItem[] = [];

    for (const article of data.articles || []) {
      // 관련 심볼 찾기
      const relatedSymbol = symbols.find(symbol => 
        article.title?.toLowerCase().includes(symbol.toLowerCase()) ||
        article.description?.toLowerCase().includes(symbol.toLowerCase())
      );

      if (relatedSymbol) {
        // 간단한 감성 분석 (키워드 기반)
        const sentiment = analyzeSentiment(article.title + ' ' + (article.description || ''));

        newsItems.push({
          id: `newsapi_${Buffer.from(article.url).toString('base64').slice(0, 10)}`,
          symbol: relatedSymbol,
          published_at: article.publishedAt,
          source: article.source?.name || 'Unknown',
          title: article.title,
          url: article.url,
          summary: article.description || article.title,
          sentiment: sentiment,
          relevance: 0.7 // NewsAPI는 관련성 점수를 제공하지 않으므로 기본값
        });
      }
    }

    return newsItems;

  } catch (error) {
    console.error('❌ NewsAPI 뉴스 수집 실패:', error);
    return [];
  }
}

/**
 * 간단한 키워드 기반 감성 분석
 * 실제 운영에서는 OpenAI API나 전용 감성 분석 서비스 사용 권장
 */
function analyzeSentiment(text: string): number {
  const lowerText = text.toLowerCase();
  
  const positiveKeywords = [
    'buy', 'bull', 'gain', 'rise', 'up', 'growth', 'profit', 'strong',
    'beat', 'exceed', 'positive', 'upgrade', 'target', 'rally'
  ];
  
  const negativeKeywords = [
    'sell', 'bear', 'loss', 'fall', 'down', 'decline', 'weak',
    'miss', 'below', 'negative', 'downgrade', 'risk', 'crash'
  ];

  let score = 0;
  
  positiveKeywords.forEach(keyword => {
    const matches = (lowerText.match(new RegExp(keyword, 'g')) || []).length;
    score += matches * 0.1;
  });
  
  negativeKeywords.forEach(keyword => {
    const matches = (lowerText.match(new RegExp(keyword, 'g')) || []).length;
    score -= matches * 0.1;
  });

  // -1 ~ +1 범위로 정규화
  return Math.max(-1, Math.min(1, score));
}

/**
 * 텍스트 요약 및 감성 점수 계산 (고급 버전)
 * OpenAI API를 사용한 더 정확한 분석
 */
export async function summarizeAndScore(text: string): Promise<{summary: string, sentiment: number}> {
  try {
    // TODO: OpenAI API를 사용한 요약 및 감성 분석
    // 현재는 기본적인 버전으로 구현
    
    const summary = text.length > 200 ? text.substring(0, 200) + '...' : text;
    const sentiment = analyzeSentiment(text);

    return { summary, sentiment };

  } catch (error) {
    console.error('❌ 텍스트 요약/감성 분석 실패:', error);
    
    // 실패 시 기본값 반환
    const summary = text.length > 200 ? text.substring(0, 200) + '...' : text;
    return { summary, sentiment: 0 };
  }
}

/**
 * 중복 뉴스 제거 (URL 기준)
 */
function removeDuplicateNews(newsItems: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const unique: NewsItem[] = [];

  for (const item of newsItems) {
    if (!seen.has(item.url)) {
      seen.add(item.url);
      unique.push(item);
    }
  }

  return unique;
}