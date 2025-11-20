import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';

/**
 * LLM 보고서 생성을 위한 페이로드 인터페이스
 */
export interface ReportPayload {
  lookback_days: number;
  portfolio: {
    cash_usd: number;
    holdings: Array<{
      symbol: string;
      shares: number;
      avg_cost: number;
    }>;
  };
  market: {
    date: string;
    sector_code: string;
    sector_title: string;
  };
  indicators: Record<string, {
    close: number;
    ema20: number;
    ema50: number;
    rsi14: number;
  }>;
  news: Array<{
    published_at: string;
    source: string;
    title: string;
    url: string;
    summary: string;
    sentiment: number;
    relevance: number;
  }>;
  scores: Record<string, number>;
}

/**
 * OpenAI 클라이언트 초기화
 */
let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY 환경변수가 설정되지 않았습니다');
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

/**
 * OpenAI GPT를 사용한 보고서 생성
 */
export async function generateReportWithOpenAI(payload: ReportPayload): Promise<string> {
  try {
    // 시스템 프롬프트 로드
    const promptPath = path.join(process.cwd(), 'prompts', 'prompt.md');
    const systemPrompt = await fs.readFile(promptPath, 'utf8');

    // LLM 모델 설정 (기본값을 gpt-5.1로 변경)
    const model = process.env.LLM_MODEL || 'gpt-5.1';

    console.log(`🤖 ${model}을 사용하여 보고서 생성 시작`);

    const messages = [
      {
        role: 'system' as const,
        content: systemPrompt
      },
      {
        role: 'user' as const,
        content: JSON.stringify(payload, null, 2)
      }
    ];

    const client = getOpenAIClient();
    
    // GPT-5 모델용 파라미터 설정
    const isGpt5 = model.startsWith('gpt-5');
    const requestParams: any = {
      model: model,
      messages: messages,
    };
    
    // GPT-5 vs 기존 모델 파라미터 구분
    if (isGpt5) {
      // GPT-5 전용 파라미터 - reasoning_effort를 low로 낮춰서 실제 출력 토큰 확보
      requestParams.max_completion_tokens = 12000; // reasoning + 실제 출력을 위한 충분한 토큰
      requestParams.reasoning_effort = "low"; // low로 설정하여 출력 토큰 확보
      // temperature는 설정하지 않음 (기본값 1 사용)
    } else {
      // 기존 GPT 모델 파라미터
      requestParams.temperature = 0.2;
      requestParams.max_tokens = 4000;
    }
    
    const response = await client.chat.completions.create(requestParams);

    console.log('📊 OpenAI 응답 구조 디버깅:', {
      choices_length: response.choices?.length || 0,
      first_choice: response.choices?.[0] ? {
        message_exists: !!response.choices[0].message,
        content_length: response.choices[0].message?.content?.length || 0,
        finish_reason: response.choices[0].finish_reason
      } : null
    });

    const report = response.choices?.[0]?.message?.content;
    
    if (!report || report.trim().length === 0) {
      console.error('❌ OpenAI 응답이 비어있음:', JSON.stringify(response, null, 2));
      throw new Error('LLM 응답이 비어있습니다');
    }

    console.log('✅ LLM 보고서 생성 완료');
    return report;

  } catch (error) {
    console.error('❌ LLM 보고서 생성 실패:', error);
    
    // 실패 시 기본 보고서 반환
    return generateFallbackReport(payload);
  }
}

/**
 * LLM 실패 시 사용할 기본 보고서 생성
 */
function generateFallbackReport(payload: ReportPayload): string {
  const { market, portfolio, indicators, news } = payload;
  
  return `# 📊 데일리 리포트 – ${market.date} (섹터: ${market.sector_title})

## 요약
- 포트폴리오 가치: 계산 중...
- 현금 보유: $${portfolio.cash_usd.toFixed(2)}
- 보유 종목 수: ${portfolio.holdings.length}개
- 섹터 모멘텀: 분석 중...

## 주문 제안
현재 LLM 서비스를 이용할 수 없어 자동 제안을 생성할 수 없습니다.
수동으로 시장 상황을 검토해 주세요.

## 보유 종목 상태
${portfolio.holdings.map(holding => 
  `- ${holding.symbol}: ${holding.shares}주 (평단가: $${holding.avg_cost.toFixed(2)})`
).join('\n')}

## 섹터 뉴스 Top ${Math.min(news.length, 5)}
${news.slice(0, 5).map(item => 
  `- ${item.title} (${item.source})`
).join('\n')}

## 메서드
- 지표: EMA(20/50), RSI(14)
- 기간: 최근 ${payload.lookback_days}일
- 상태: LLM 서비스 일시 중단

> *본 리포트는 투자자문이 아니며, 모든 결정과 책임은 사용자에게 있습니다.*`;
}

/**
 * GPT-5-nano를 사용한 리포트 요약 생성
 */
export async function generateReportSummary(reportContent: string): Promise<string> {
  try {
    const summaryPrompt = `다음 투자 리포트를 2-3문장으로 간단히 요약해주세요. 핵심 투자 포인트와 추천 종목을 중심으로 요약하세요:

${reportContent.substring(0, 2000)}...`; // 리포트 내용을 일부만 사용

    console.log('🤖 GPT-5-nano를 사용하여 리포트 요약 생성 시작');

    const messages = [
      {
        role: 'system' as const,
        content: '투자 리포트를 간결하고 명확하게 요약하는 전문가입니다.'
      },
      {
        role: 'user' as const,
        content: summaryPrompt
      }
    ];

    const client = getOpenAIClient();
    
    const response = await client.chat.completions.create({
      model: 'gpt-5-nano', // GPT-5-nano 사용 (요약용)
      messages: messages,
      max_completion_tokens: 500, // reasoning + 출력을 위한 충분한 토큰
      reasoning_effort: "low" // 낮은 추론 레벨로 빠른 처리
      // temperature는 설정하지 않음 (기본값 1 사용)
    });

    const summary = response.choices[0].message?.content;
    
    if (!summary) {
      throw new Error('요약 생성 실패');
    }

    console.log('✅ GPT-5-nano 요약 생성 완료');
    return summary;

  } catch (error) {
    console.error('❌ GPT-5-nano 요약 생성 실패:', error);
    
    // 실패 시 기본 요약 반환
    return '리포트 요약을 생성할 수 없습니다. 전체 리포트를 확인해주세요.';
  }
}

/**
 * Manager_Agent 전용 리포트 생성 (promptManager.md 사용)
 */
export async function generateManagerReport(payload: any): Promise<string> {
  try {
    const client = getOpenAIClient();
    
    // Manager 전용 프롬프트 사용
    const managerPrompt = payload.manager_prompt;

    // LLM 모델 설정 (기본값을 gpt-5.1로 변경)
    const model = process.env.LLM_MODEL || 'gpt-5.1';

    console.log(`🤖 ${model}을 사용하여 보고서 생성 시작`);

    // Manager_Agent 데이터 구성
    const managerData = `
## 입력 데이터

### Agent 보고서
**Agent_GPT 보고서:**
${payload.agent_reports.agent_gpt || 'N/A'}

**Agent_Gemini 보고서:**
${payload.agent_reports.agent_gemini || 'N/A'}

**Agent_Claude 보고서:**
${payload.agent_reports.agent_claude || 'N/A'}

### 현재 포트폴리오
${JSON.stringify(payload.portfolio, null, 2)}

### 성과 분석
${JSON.stringify(payload.performance, null, 2)}

### 환율 정보
${JSON.stringify(payload.exchange_rate, null, 2)}
`;

    const messages = [
      {
        role: 'system' as const,
        content: managerPrompt
      },
      {
        role: 'user' as const,
        content: managerData
      }
    ];

    const response = await client.chat.completions.create({
      model,
      messages,
      max_completion_tokens: 4000
    });

    // 응답 구조 디버깅
    console.log('📊 OpenAI 응답 구조 디버깅:', {
      choices_length: response.choices?.length || 0,
      first_choice: response.choices?.[0] ? {
        message_exists: !!response.choices[0].message,
        content_length: response.choices[0].message?.content?.length || 0,
        finish_reason: response.choices[0].finish_reason
      } : null
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI API로부터 빈 응답을 받았습니다');
    }

    console.log('✅ LLM 보고서 생성 완료');
    return content;

  } catch (error) {
    console.error('❌ Manager 리포트 생성 중 오류:', error);
    throw error;
  }
}

/**
 * 다른 LLM 제공자 지원 (향후 확장용)
 */
export async function generateReport(payload: ReportPayload): Promise<string> {
  const provider = process.env.LLM_PROVIDER || 'OPENAI';

  switch (provider.toUpperCase()) {
    case 'OPENAI':
      return await generateReportWithOpenAI(payload);
    
    // TODO: 다른 LLM 제공자 추가
    // case 'ANTHROPIC':
    //   return await generateReportWithAnthropic(payload);
    
    default:
      console.warn(`⚠️ 알 수 없는 LLM 제공자: ${provider}, OpenAI 사용`);
      return await generateReportWithOpenAI(payload);
  }
}