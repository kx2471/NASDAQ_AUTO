import OpenAI from 'openai';

/**
 * Grok API 클라이언트 초기화
 * xAI의 Grok은 OpenAI 호환 API를 사용하므로 OpenAI SDK를 활용
 */
function getGrokClient() {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error('GROK_API_KEY 환경변수가 설정되지 않았습니다');
  }

  return new OpenAI({
    apiKey: apiKey,
    baseURL: 'https://api.x.ai/v1'
  });
}

/**
 * Grok으로 투자 리포트 생성 (Retry Logic + Fallback 포함)
 */
export async function generateReportWithGrok(reportPayload: any): Promise<string> {
  const client = getGrokClient();
  const prompt = await createInvestmentPromptFromPayload(reportPayload);

  // 환경변수에서 지정된 모델만 사용
  const envModel = process.env.GROK_MODEL || 'grok-4-1-fast-reasoning';
  const modelAttempt = { name: envModel, displayName: `Grok (${envModel})` };

  try {
    console.log(`🤖 ${modelAttempt.displayName}를 사용하여 보고서 생성 중...`);

    const response = await client.chat.completions.create({
      model: modelAttempt.name,
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: 0.7,
      max_tokens: 8192
    });

    const responseText = response.choices[0]?.message?.content;

    if (!responseText) {
      throw new Error('API에서 응답을 받지 못했습니다');
    }

    // 리포트 메타데이터 헤더 생성
    const currentDate = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const reportHeader = `# 🤖 Agent_Grok 주간 리포트

---

## 📋 리포트 메타데이터

**생성 일시**: ${currentDate}
**사용 모델**: ${envModel} (xAI Grok)

---

`;

    console.log(`✅ ${modelAttempt.displayName} 보고서 생성 성공!`);
    return reportHeader + responseText;

  } catch (error: any) {
    console.error(`❌ ${modelAttempt.displayName} 보고서 생성 실패:`, error.message);
    return generateFallbackGrokReport(reportPayload);
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
 * Grok 실패 시 폴백 리포트 생성
 */
function generateFallbackGrokReport(reportPayload: any): string {
  const today = new Date().toLocaleDateString('ko-KR');

  const stocks = reportPayload.stocks || [];
  const holdings = reportPayload.portfolio?.holdings || [];
  const news = reportPayload.news || [];

  return `# 📊 Grok 데일리 투자 리포트 (폴백)

**⚠️ 알림**: Grok API 연결 실패로 인한 기본 리포트입니다.

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

Grok API 연결 문제로 상세 분석을 제공할 수 없습니다.
정상 서비스 복구 후 다시 시도하시기 바랍니다.

---
*본 리포트는 기술적 오류로 인한 임시 버전입니다*`;
}

/**
 * Grok API 연결 테스트
 */
export async function testGrokConnection(): Promise<boolean> {
  try {
    const client = getGrokClient();

    const response = await client.chat.completions.create({
      model: process.env.GROK_MODEL || 'grok-4-1-fast-reasoning',
      messages: [{
        role: 'user',
        content: 'Test connection. Reply with "OK"'
      }],
      max_tokens: 100
    });

    const responseText = response.choices[0]?.message?.content;
    return !!(responseText && responseText.includes('OK'));
  } catch (error) {
    console.error('Grok 연결 테스트 실패:', error);
    return false;
  }
}
