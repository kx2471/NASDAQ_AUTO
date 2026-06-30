import Anthropic from '@anthropic-ai/sdk';

/**
 * Claude API 클라이언트 초기화
 */
function getClaudeClient() {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error('CLAUDE_API_KEY 환경변수가 설정되지 않았습니다');
  }
  
  return new Anthropic({
    apiKey: apiKey
  });
}

/**
 * Claude로 투자 리포트 생성 (Retry Logic + Fallback 포함)
 */
export async function generateReportWithClaude(reportPayload: any): Promise<string> {
  const anthropic = getClaudeClient();
  const prompt = await createInvestmentPromptFromPayload(reportPayload);
  
  // 환경변수에서 지정된 모델만 사용
  const envModel = process.env.CLAUDE_MODEL || 'claude-opus-4-8';
  const modelAttempt = { name: envModel, displayName: `Claude (${envModel})` };

  try {
    console.log(`🤖 ${modelAttempt.displayName}를 사용하여 보고서 생성 중...`);

    // Opus 4.8은 temperature/top_p/budget_tokens를 거부(400)하므로 전달하지 않음
    const response = await anthropic.messages.create({
      model: modelAttempt.name,
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const responseText = response.content[0]?.type === 'text' ? response.content[0].text : '';

    if (!responseText) {
      throw new Error('API에서 응답을 받지 못했습니다');
    }

    // 리포트 메타데이터 헤더 생성
    const currentDate = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const reportHeader = `# 🤖 Agent_Claude 주간 리포트

---

## 📋 리포트 메타데이터

**생성 일시**: ${currentDate}
**사용 모델**: ${envModel} (Anthropic Claude)

---

`;

    console.log(`✅ ${modelAttempt.displayName} 보고서 생성 성공!`);
    return reportHeader + responseText;

  } catch (error: any) {
    console.error(`❌ ${modelAttempt.displayName} 보고서 생성 실패:`, error.message);
    return generateFallbackClaudeReport(reportPayload);
  }
}

/**
 * reportPayload를 사용한 투자 리포트 프롬프트 생성
 */
async function createInvestmentPromptFromPayload(reportPayload: any): Promise<string> {
  const fs = require('fs/promises');
  const path = require('path');

  try {
    // prompt.md 파일 로드
    const promptPath = path.join(process.cwd(), 'prompts', 'prompt.md');
    const promptTemplate = await fs.readFile(promptPath, 'utf8');

    // reportPayload에서 필요한 데이터 추출
    const dataContext = `
다음 데이터를 사용하여 리포트를 작성하세요:

**portfolio**: ${JSON.stringify(reportPayload.portfolio, null, 2)}
**indicators**: ${JSON.stringify(reportPayload.indicators, null, 2)}
**currentPrices**: ${JSON.stringify(reportPayload.currentPrices, null, 2)}
**market**: ${JSON.stringify(reportPayload.market, null, 2)}
**scores**: ${JSON.stringify(reportPayload.scores, null, 2)}
**news**: ${JSON.stringify(reportPayload.news?.slice(0, 5), null, 2)}
**performanceReport**: ${reportPayload.performanceReport}

${promptTemplate}`;

    return dataContext;

  } catch (error) {
    console.warn('prompt.md 파일 로드 실패, 기본 프롬프트 사용:', error);

    // 폴백: 기본 프롬프트
    return `다음 데이터를 바탕으로 통합 포트폴리오 리포트를 한국어로 작성하세요.

**보유 종목**: ${JSON.stringify(reportPayload.portfolio?.holdings, null, 2)}
**기술지표**: ${JSON.stringify(reportPayload.indicators, null, 2)}
**뉴스**: ${JSON.stringify(reportPayload.news?.slice(0, 5), null, 2)}
**성과 분석**: ${reportPayload.performanceReport}

1000만원 달성을 위한 구체적인 매매 전략과 종목 추천을 포함해주세요.`;
  }
}

/**
 * 투자 리포트 프롬프트 생성 (prompt.md 파일 사용) - 레거시 함수
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
 * Claude 실패 시 폴백 리포트 생성
 */
function generateFallbackClaudeReport(reportPayload: any): string {
  const today = new Date().toLocaleDateString('ko-KR');
  
  const stocks = reportPayload.stocks || [];
  const holdings = reportPayload.portfolio?.holdings || [];
  const news = reportPayload.news || [];

  return `# 📊 Claude 데일리 투자 리포트 (폴백)

**⚠️ 알림**: Claude API 연결 실패로 인한 기본 리포트입니다.

## 📈 분석 요약 (${today})

**스크리닝 결과**: ${stocks.length}개 종목 분석 완료
**보유 종목**: ${holdings.length}개
**수집 뉴스**: ${news.length}개

## 🎯 주요 지표

**상위 종목**:
${stocks.slice(0, 5).map((stock: any, i: number) =>
  `${i + 1}. ${stock.symbol} - ${stock.sector || 'Unknown'} 섹터`
).join('\n')}

**기술지표 현황**:
- 보유 종목 수: ${holdings.length}개
- 수집된 뉴스: ${news.length}개

## ⚠️ 중요 안내

Claude API 연결 문제로 상세 분석을 제공할 수 없습니다.
정상 서비스 복구 후 다시 시도하시기 바랍니다.

---
*본 리포트는 기술적 오류로 인한 임시 버전입니다*`;
}

/**
 * Claude API 연결 테스트
 */
export async function testClaudeConnection(): Promise<boolean> {
  try {
    const anthropic = getClaudeClient();
    
    const response = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-opus-4-8',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: 'Test connection. Reply with "OK"'
      }]
    });
    
    const responseText = response.content[0]?.type === 'text' ? response.content[0].text : '';
    return !!(responseText && responseText.includes('OK'));
  } catch (error) {
    console.error('Claude 연결 테스트 실패:', error);
    return false;
  }
}