/**
 * 보고서 생성 로직
 * 데이터를 분석하고 투자 점수를 계산하는 핵심 비즈니스 로직
 */

/**
 * 점수화 가중치 설정
 */
export const SCORING_WEIGHTS = {
  momentum: 0.4,    // EMA 기반 모멘텀
  rsi: 0.3,         // RSI 기반 신호
  news: 0.3         // 뉴스 감성
} as const;

/**
 * 거래 임계값 설정
 */
export const TRADING_THRESHOLDS = {
  buy: 0.65,        // 매수 임계값
  sell: 0.35,       // 매도 임계값
  rsi_overbought: 70,   // RSI 과매수
  rsi_oversold: 35,     // RSI 과매도
  position_limit: 0.20, // 단일 종목 비중 상한 (20%)
  partial_sell: 0.30    // 부분매도 비율 (30%)
} as const;

/**
 * 투자 신호 인터페이스
 */
export interface InvestmentSignal {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  quantity: number;
  price: number;
  reason: string;
  confidence: number;
}

/**
 * 종목별 투자 점수 계산
 */
export function calculateScore(data: {
  ema20: number;
  ema50: number;
  rsi14: number;
  newsSentiment: number;
}): number {
  const { ema20, ema50, rsi14, newsSentiment } = data;
  
  let score = 0;
  
  // 1. 모멘텀 점수 (EMA 교차)
  const momentumScore = ema20 > ema50 ? 1 : -1;
  score += momentumScore * SCORING_WEIGHTS.momentum;
  
  // 2. RSI 신호 점수
  let rsiScore = 0;
  if (rsi14 < TRADING_THRESHOLDS.rsi_oversold) {
    rsiScore = 1; // 과매도 = 매수 신호
  } else if (rsi14 > TRADING_THRESHOLDS.rsi_overbought) {
    rsiScore = -1; // 과매수 = 매도 신호
  } else {
    rsiScore = 0; // 중립
  }
  score += rsiScore * SCORING_WEIGHTS.rsi;
  
  // 3. 뉴스 감성 점수 (이미 -1 ~ +1 범위)
  score += newsSentiment * SCORING_WEIGHTS.news;
  
  // 최종 점수를 0-1 범위로 정규화
  return Math.max(0, Math.min(1, (score + 1) / 2));
}

/**
 * 투자 제안 생성
 */
export function generateInvestmentSignals(params: {
  indicators: Record<string, any>;
  newsSentiment: Record<string, number>;
  currentPrices: Record<string, number>;
  portfolio: {
    cash_usd: number;
    holdings: Array<{ symbol: string; shares: number; avg_cost: number }>;
  };
}): InvestmentSignal[] {
  const { indicators, newsSentiment, currentPrices, portfolio } = params;
  const signals: InvestmentSignal[] = [];
  
  // 현재 포트폴리오 가치 계산
  const portfolioValue = calculatePortfolioValue(portfolio, currentPrices);
  
  for (const symbol of Object.keys(indicators)) {
    try {
      const indicator = indicators[symbol];
      const price = currentPrices[symbol];
      const sentiment = newsSentiment[symbol] || 0;
      
      if (!indicator || !price) continue;
      
      // 투자 점수 계산
      const score = calculateScore({
        ema20: indicator.ema20,
        ema50: indicator.ema50,
        rsi14: indicator.rsi14,
        newsSentiment: sentiment
      });
      
      // 현재 보유 수량
      const currentHolding = portfolio.holdings.find(h => h.symbol === symbol);
      const currentShares = currentHolding?.shares || 0;
      const currentValue = currentShares * price;
      const currentWeight = portfolioValue > 0 ? currentValue / portfolioValue : 0;
      
      // 투자 신호 결정
      const signal = determineAction({
        symbol,
        score,
        price,
        rsi: indicator.rsi14,
        currentShares,
        currentWeight,
        cash: portfolio.cash_usd,
        portfolioValue
      });
      
      if (signal) {
        signals.push(signal);
      }
      
    } catch (error) {
      console.error(`❌ ${symbol} 신호 생성 실패:`, error);
    }
  }
  
  return signals.sort((a, b) => b.confidence - a.confidence);
}

/**
 * 개별 종목의 매매 액션 결정
 */
function determineAction(params: {
  symbol: string;
  score: number;
  price: number;
  rsi: number;
  currentShares: number;
  currentWeight: number;
  cash: number;
  portfolioValue: number;
}): InvestmentSignal | null {
  const { 
    symbol, score, price, rsi, currentShares, 
    currentWeight, cash, portfolioValue 
  } = params;
  
  // 매수 조건
  if (score >= TRADING_THRESHOLDS.buy && rsi < 60) {
    const maxPosition = portfolioValue * TRADING_THRESHOLDS.position_limit;
    const availableForPurchase = Math.max(0, maxPosition - (currentShares * price));
    const maxShares = Math.floor(Math.min(cash, availableForPurchase) / price);
    
    if (maxShares > 0) {
      return {
        symbol,
        action: 'BUY',
        quantity: maxShares,
        price,
        reason: `점수 ${score.toFixed(2)} (매수 신호), RSI ${rsi.toFixed(1)} (적정 수준)`,
        confidence: score
      };
    }
  }
  
  // 매도 조건
  if ((score <= TRADING_THRESHOLDS.sell || rsi > TRADING_THRESHOLDS.rsi_overbought) && currentShares > 0) {
    const sellShares = rsi > TRADING_THRESHOLDS.rsi_overbought 
      ? currentShares  // RSI 과매수시 전량 매도
      : Math.floor(currentShares * TRADING_THRESHOLDS.partial_sell); // 부분 매도
    
    if (sellShares > 0) {
      const reason = rsi > TRADING_THRESHOLDS.rsi_overbought
        ? `RSI ${rsi.toFixed(1)} 과매수 구간, 전량 매도`
        : `점수 ${score.toFixed(2)} 하락, 부분 매도 (${Math.round(TRADING_THRESHOLDS.partial_sell * 100)}%)`;
      
      return {
        symbol,
        action: 'SELL',
        quantity: sellShares,
        price,
        reason,
        confidence: 1 - score
      };
    }
  }
  
  return null; // HOLD
}

/**
 * 포트폴리오 가치 계산
 */
function calculatePortfolioValue(
  portfolio: { 
    cash_usd: number; 
    holdings: Array<{ symbol: string; shares: number; avg_cost: number }> 
  },
  currentPrices: Record<string, number>
): number {
  let totalValue = portfolio.cash_usd;
  
  for (const holding of portfolio.holdings) {
    const currentPrice = currentPrices[holding.symbol];
    if (currentPrice) {
      totalValue += holding.shares * currentPrice;
    }
  }
  
  return totalValue;
}

/**
 * 보고서 템플릿 데이터 생성
 */
export function generateReportTemplate(data: {
  date: string;
  sectorTitle: string;
  portfolio: any;
  signals: InvestmentSignal[];
  indicators: Record<string, any>;
  news: any[];
  currentPrices: Record<string, number>;
}): string {
  const { date, sectorTitle, portfolio, signals, indicators, news, currentPrices } = data;
  
  // 포트폴리오 가치 계산
  const portfolioValue = calculatePortfolioValue(portfolio, currentPrices);
  
  // 보유 종목 테이블 데이터
  const holdingsTable = generateHoldingsTable(portfolio.holdings, indicators, currentPrices);
  
  // 뉴스 섹션 데이터
  const newsSection = generateNewsSection(news.slice(0, 5));
  
  return `# 📊 데일리 리포트 – ${date} (섹터: ${sectorTitle})

## 요약
- 포트폴리오 가치: $${portfolioValue.toFixed(2)}
- 현금 보유: $${portfolio.cash_usd.toFixed(2)}
- 보유 종목 수: ${portfolio.holdings.length}개
- 투자 제안: ${signals.length}개

## 주문 제안
${signals.map(signal => 
  `- **${signal.symbol}**: ${signal.action} ${signal.quantity}주 @$${signal.price.toFixed(2)} — _${signal.reason}_`
).join('\n') || '- 현재 제안할 주문이 없습니다.'}

## 보유 종목 상태
${holdingsTable}

## 섹터 뉴스 Top ${news.length}
${newsSection}

## 방법론
- 지표: EMA(20/50), RSI(14)
- 신호 가중치: 모멘텀 ${SCORING_WEIGHTS.momentum}, RSI ${SCORING_WEIGHTS.rsi}, 뉴스 ${SCORING_WEIGHTS.news}
- 거래 임계값: 매수 ${TRADING_THRESHOLDS.buy}, 매도 ${TRADING_THRESHOLDS.sell}

> *본 리포트는 투자자문이 아니며, 모든 결정과 책임은 사용자에게 있습니다.*`;
}

/**
 * 보유 종목 테이블 생성
 */
function generateHoldingsTable(
  holdings: Array<{ symbol: string; shares: number; avg_cost: number }>,
  indicators: Record<string, any>,
  currentPrices: Record<string, number>
): string {
  if (holdings.length === 0) {
    return '현재 보유 종목이 없습니다.';
  }
  
  let table = '| 종목 | 수량 | 평단 | 현재가 | 평가손익 | RSI14 | EMA교차 |\n';
  table += '|------|-----:|-----:|-------:|--------:|------:|:-------:|\n';
  
  for (const holding of holdings) {
    const { symbol, shares, avg_cost } = holding;
    const currentPrice = currentPrices[symbol] || 0;
    const indicator = indicators[symbol];
    
    const pnl = (currentPrice - avg_cost) * shares;
    const pnlPercent = avg_cost > 0 ? ((currentPrice - avg_cost) / avg_cost * 100) : 0;
    const rsi = indicator?.rsi14 || 0;
    const emaCross = indicator?.ema20 > indicator?.ema50 ? '✅' : '❌';
    
    const pnlColor = pnl >= 0 ? '+' : '';
    
    table += `| ${symbol} | ${shares} | $${avg_cost.toFixed(2)} | $${currentPrice.toFixed(2)} | ${pnlColor}$${pnl.toFixed(2)} (${pnlPercent.toFixed(1)}%) | ${rsi.toFixed(1)} | ${emaCross} |\n`;
  }
  
  return table;
}

/**
 * 뉴스 섹션 생성
 */
function generateNewsSection(news: any[]): string {
  if (news.length === 0) {
    return '- 관련 뉴스가 없습니다.';
  }
  
  return news.map(item => {
    const sentimentEmoji = item.sentiment > 0.2 ? '📈' : 
                          item.sentiment < -0.2 ? '📉' : '📊';
    const date = new Date(item.published_at).toLocaleDateString('ko-KR');
    
    return `- ${sentimentEmoji} (${date}) **${item.title}** — ${item.source}
  - 요약: ${item.summary}
  - 감성: ${item.sentiment.toFixed(2)} | 관련성: ${item.relevance.toFixed(2)}`;
  }).join('\n\n');
}

/**
 * 간단한 보고서 파일 생성 (LLM 대신 사용할 기본 템플릿)
 */
export async function generateReportFile(params: any): Promise<string> {
  // 이 함수는 향후 구현 예정
  // LLM 서비스가 없을 때 사용할 기본 보고서 생성
  return generateReportTemplate(params);
}