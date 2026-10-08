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

    // 야후 파이낸스 종목별 RSS (무키) — 종목 코드로 직접 조회하므로 그 종목 기사만 온다.
    // 이전의 NewsAPI 경로는 두 가지로 고장 나 있었다 (2026-10-09 감시 중 발견):
    //  1) 무료 한도 100건/일인데 스크리닝이 종목마다 1건씩 불러 하루 3사이클이면 초과 → 429
    //  2) 종목 코드를 일반 검색어로 써서 "P"·"A"·"FORM" 같은 코드는 무관한 기사가 걸림
    // 그 결과 40여 종목 중 36개가 뉴스 0건이었고, 종합 점수의 30%(뉴스)가 사실상 상수였다.
    // Alpha Vantage(무료 25건/일)도 같은 이유로 쓰지 않는다.
    if (symbols.length > 0) {
      newsItems = await fetchFromYahooRss(symbols, limit, fromDate);
    }

    // 중복 제거 (URL 기준)
    const uniqueNews = removeDuplicateNews(newsItems);

    // fetchFromYahooRss가 종목을 돌아가며 섞어 둔 순서를 유지한다 (앞에서 자르는 호출부가
    // 한 종목 기사만 받지 않도록). 관련성 점수는 모두 같아 정렬할 근거가 없다.
    return uniqueNews.slice(0, limit);

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
 * XML 엔티티·CDATA를 풀어 평문으로 만든다 (RSS 제목·요약용)
 * @param s RSS 필드 원문
 * @returns 평문
 */
function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 야후 파이낸스 종목별 RSS에서 뉴스 수집 (API 키 불필요)
 * @param symbols 종목 코드 목록
 * @param limit 전체 반환 상한
 * @param fromDate 이 날짜(YYYY-MM-DD) 이후 기사만. 없으면 전부
 * @returns 종목을 돌아가며 섞은 뉴스 목록 (각 종목 안에서는 최신순)
 */
async function fetchFromYahooRss(symbols: string[], limit: number, fromDate?: string): Promise<NewsItem[]> {
  const since = fromDate ? Date.parse(fromDate) : 0;
  const perSymbol = Math.max(3, Math.ceil(limit / symbols.length));
  const bySymbol: NewsItem[][] = [];
  let failed = 0;

  // 동시 4개씩 — 한 사이클에 종목 수십 개를 조회하므로 순차는 느리고, 무제한은 차단 위험이 있다.
  for (let i = 0; i < symbols.length; i += 4) {
    const batch = symbols.slice(i, i + 4);
    const results = await Promise.all(batch.map(async (symbol): Promise<NewsItem[]> => {
      try {
        const response = await axios.get('https://feeds.finance.yahoo.com/rss/2.0/headline', {
          params: { s: symbol.replace('.', '-'), region: 'US', lang: 'en-US' },
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 8000,
          responseType: 'text'
        });
        const items: NewsItem[] = [];
        for (const m of String(response.data).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
          const field = (name: string) => decodeXml((m[1].match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1] || '');
          const title = field('title');
          const url = field('link');
          const published = Date.parse(field('pubDate'));
          if (!title || !url || Number.isNaN(published) || published < since) continue;
          const summary = field('description') || title;
          items.push({
            id: `yahoo_${Buffer.from(url).toString('base64').slice(-16)}`,
            symbol,
            published_at: new Date(published).toISOString(),
            source: 'Yahoo Finance',
            title,
            url,
            summary: summary.length > 300 ? summary.slice(0, 300) + '...' : summary,
            sentiment: analyzeSentiment(title + ' ' + summary),
            relevance: 0.8
          });
        }
        return items.sort((a, b) => b.published_at.localeCompare(a.published_at)).slice(0, perSymbol);
      } catch (error) {
        failed++;
        return [];
      }
    }));
    bySymbol.push(...results);
  }

  // 실패는 한 줄로 요약한다 (이전 경로는 axios 오류 객체를 통째로 찍어 오류 로그가 8MB가 됐다)
  if (failed > 0) console.warn(`⚠️ 야후 뉴스 조회 실패 ${failed}/${symbols.length}종목 (해당 종목은 뉴스 없음으로 처리)`);

  // 종목을 돌아가며 한 건씩 — 앞에서 N개만 잘라 써도 여러 종목이 고르게 들어간다
  const mixed: NewsItem[] = [];
  for (let round = 0; round < perSymbol; round++) {
    for (const list of bySymbol) if (list[round]) mixed.push(list[round]);
  }
  return mixed;
}

/**
 * (미사용 — 2026-10-09부터 야후 RSS로 대체. 한도·검색어 문제는 fetchNews 주석 참고)
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
    const matches = (lowerText.match(new RegExp(`\\b${keyword}`, 'g')) || []).length;
    score += matches * 0.1;
  });
  
  negativeKeywords.forEach(keyword => {
    const matches = (lowerText.match(new RegExp(`\\b${keyword}`, 'g')) || []).length;
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