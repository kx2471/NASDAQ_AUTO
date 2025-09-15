import { GoogleGenAI } from '@google/genai';

/**
 * Gemini Pro API 클라이언트 초기화
 */
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다');
  }
  
  return new GoogleGenAI({
    apiKey: apiKey
  });
}

/**
 * Gemini Pro로 투자 리포트 생성 (Retry Logic + Fallback 포함)
 */
export async function generateReportWithGemini(
  stocks: any[], 
  priceData: any, 
  indicators: any, 
  news: any[], 
  holdings: any[]
): Promise<string> {
  const ai = getGeminiClient();
  const prompt = await createInvestmentPrompt(stocks, priceData, indicators, news, holdings);
  
  // 시도할 모델 순서 (Primary -> Fallback models)
  const modelAttempts = [
    { name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
    { name: 'gemini-1.5-flash-latest', displayName: 'Gemini 1.5 Flash Latest' },
    { name: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' }
  ];
  
  for (const modelAttempt of modelAttempts) {
    try {
      console.log(`🤖 ${modelAttempt.displayName}를 사용하여 보고서 생성 시도 중...`);
      
      // Retry Logic: 각 모델당 3번까지 시도
      for (let retryCount = 1; retryCount <= 3; retryCount++) {
        try {
          const response = await ai.models.generateContent({
            model: modelAttempt.name,
            contents: prompt,
            config: {
              temperature: 0.7,
              topP: 0.9,
              topK: 40,
              maxOutputTokens: 8192,
            }
          });
          
          if (!response.text) {
            throw new Error('API에서 응답을 받지 못했습니다');
          }
          
          console.log(`✅ ${modelAttempt.displayName} 보고서 생성 성공! (${retryCount}번째 시도)`);
          return response.text;
          
        } catch (retryError: any) {
          console.warn(`⚠️ ${modelAttempt.displayName} ${retryCount}번째 시도 실패:`, retryError.message);
          
          // 503 에러가 아니거나 마지막 재시도인 경우 다음 모델로 넘어감
          if (!retryError.message.includes('503') && !retryError.message.includes('overloaded')) {
            break; // 503이 아닌 에러는 재시도 불필요
          }
          
          if (retryCount < 3) {
            // Exponential backoff: 2초, 4초, 8초 대기
            const waitTime = Math.pow(2, retryCount) * 1000;
            console.log(`⏰ ${waitTime/1000}초 대기 후 재시도...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
      }
      
      console.log(`❌ ${modelAttempt.displayName} 모든 재시도 실패, 다음 모델로 전환...`);
      
    } catch (modelError) {
      console.error(`❌ ${modelAttempt.displayName} 모델 오류:`, modelError);
    }
  }
  
  console.warn('⚠️ 모든 Gemini 모델 시도 실패, 폴백 리포트 생성');
  return generateFallbackGeminiReport(stocks, priceData, indicators, news, holdings);
}

/**
 * 투자 리포트 프롬프트 생성 (prompt.md 파일 사용)
 */
async function createInvestmentPrompt(
  stocks: any[], 
  priceData: any, 
  indicators: any, 
  news: any[], 
  holdings: any[]
): Promise<string> {
  const fs = require('fs/promises');
  const path = require('path');
  
  try {
    // prompt.md 파일 로드
    const promptPath = path.join(process.cwd(), 'prompts', 'prompt.md');
    const promptTemplate = await fs.readFile(promptPath, 'utf8');
    
    // 실제 데이터 정리
    const reportData = {
      portfolio: {
        holdings: holdings.map(holding => ({
          symbol: holding.symbol,
          shares: holding.shares,
          avg_cost: holding.averagePrice
        }))
      },
      indicators: indicators,
      currentPrices: Object.fromEntries(
        Object.entries(indicators).map(([symbol, ind]: [string, any]) => [symbol, ind.close || 0])
      ),
      market: {
        exchange_rate: { usd_to_krw: 1350 } // 기본값
      },
      scores: Object.fromEntries(
        stocks.map(stock => [stock.symbol, Math.random() * 0.5 + 0.5])
      ),
      news: news,
      lookback_days: 30
    };
    
    // 데이터를 JSON 형태로 첨부
    const dataContext = `
다음 데이터를 사용하여 리포트를 작성하세요:

**portfolio.holdings**: ${JSON.stringify(reportData.portfolio.holdings, null, 2)}
**indicators**: ${JSON.stringify(indicators, null, 2)}
**currentPrices**: ${JSON.stringify(reportData.currentPrices, null, 2)}
**market.exchange_rate**: ${JSON.stringify(reportData.market.exchange_rate, null, 2)}
**scores**: ${JSON.stringify(reportData.scores, null, 2)}
**news**: ${JSON.stringify(news.slice(0, 5), null, 2)}

${promptTemplate}`;
    
    return dataContext;
    
  } catch (error) {
    console.warn('prompt.md 파일 로드 실패, 기본 프롬프트 사용:', error);
    
    // 폴백: 기본 프롬프트
    return `다음 데이터를 바탕으로 통합 포트폴리오 리포트를 한국어로 작성하세요.

**보유 종목**: ${JSON.stringify(holdings, null, 2)}
**기술지표**: ${JSON.stringify(indicators, null, 2)}
**뉴스**: ${JSON.stringify(news.slice(0, 5), null, 2)}

1000만원 달성을 위한 구체적인 매매 전략과 종목 추천을 포함해주세요.`;
  }
}

/**
 * Gemini 실패 시 폴백 리포트 생성
 */
function generateFallbackGeminiReport(
  stocks: any[], 
  priceData: any, 
  indicators: any, 
  news: any[], 
  holdings: any[]
): string {
  const today = new Date().toLocaleDateString('ko-KR');
  
  return `# 📊 Gemini Pro 데일리 투자 리포트 (폴백)

**⚠️ 알림**: Gemini API 연결 실패로 인한 기본 리포트입니다.

## 📈 분석 요약 (${today})

**스크리닝 결과**: ${stocks.length}개 종목 분석 완료
**보유 종목**: ${holdings.length}개 
**수집 뉴스**: ${news.length}개

## 🎯 주요 지표

**상위 종목**:
${stocks.slice(0, 5).map((stock, i) => 
  `${i + 1}. ${stock.symbol} - ${stock.sector} 섹터`
).join('\n')}

**기술지표 현황**:
- 전체 종목 중 RSI 50 이상: ${Object.values(indicators).filter((ind: any) => ind.rsi14 > 50).length}개
- EMA 정배열 종목: ${Object.values(indicators).filter((ind: any) => ind.ema20 > ind.ema50).length}개

## ⚠️ 중요 안내

Gemini API 연결 문제로 상세 분석을 제공할 수 없습니다.
정상 서비스 복구 후 다시 시도하시기 바랍니다.

---
*본 리포트는 기술적 오류로 인한 임시 버전입니다*`;
}

/**
 * Gemini API 연결 테스트
 */
export async function testGeminiConnection(): Promise<boolean> {
  try {
    const ai = getGeminiClient();
    
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
      contents: 'Test connection. Reply with "OK"'
    });
    
    return !!(response.text && response.text.includes('OK'));
  } catch (error) {
    console.error('Gemini 연결 테스트 실패:', error);
    return false;
  }
}