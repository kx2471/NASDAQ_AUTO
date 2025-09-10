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
    const promptPath = path.join(process.cwd(), 'prompt.md');
    const systemPrompt = await fs.readFile(promptPath, 'utf8');

    // LLM 모델 설정
    const model = process.env.LLM_MODEL || 'gpt-4';

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
    const response = await client.chat.completions.create({
      model: model,
      messages: messages,
      temperature: 0.2,
      max_tokens: 4000,
    });

    const report = response.choices[0].message?.content;
    
    if (!report) {
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