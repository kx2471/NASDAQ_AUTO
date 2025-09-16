import { generateReport } from './llm';
import OpenAI from 'openai';
import { getHoldings, getCashBalance } from '../storage/database';
import { getCachedExchangeRate } from './exchange';
import { calculateCurrentPerformance, analyzeTargetProgress } from './performance';
import fs from 'fs/promises';
import path from 'path';

/**
 * 한국 시간 기준 날짜 문자열 생성 (YYYYMMDD 형식)
 */
function getKoreanDateString(): string {
  const now = new Date();
  const koreanTime = new Date(now.getTime() + (9 * 60 * 60 * 1000)); // UTC + 9시간
  return koreanTime.toISOString().split('T')[0].replace(/-/g, '');
}

/**
 * Manager_Agent 서비스
 * 3개 Agent의 보고서를 종합하여 최종 통합 의사결정 제공
 */

export interface ManagerReportInput {
  agentGptReport: string;
  agentGeminiReport: string;
  agentClaudeReport: string;
  portfolioData: any;
  performanceData: any;
}

/**
 * Manager_Agent 통합 리포트 생성
 */
export async function generateManagerReport(): Promise<string> {
  console.log('🏢 Manager_Agent 통합 리포트 생성 시작...');
  
  try {
    // 1. Agent 보고서들 로드
    const agentReports = await loadAgentReports();

    // 2. 현재 포트폴리오 데이터 수집
    console.log('📊 포트폴리오 데이터 수집 중...');
    const portfolioData = await getCurrentPortfolioData();
    console.log('✅ 포트폴리오 데이터 수집 완료');

    // 3. 성과 분석 데이터
    console.log('📈 성과 분석 데이터 수집 중...');
    const performanceData = await getCurrentPerformanceData();
    console.log('✅ 성과 분석 데이터 수집 완료:', performanceData ? '데이터 있음' : '데이터 없음');

    // 4. Manager_Agent 프롬프트 로드
    const managerPrompt = await loadManagerPrompt();
    
    // 5. 통합 분석 페이로드 준비
    const payload = await prepareManagerPayload({
      agentReports,
      portfolioData,
      performanceData,
      managerPrompt
    });
    
    // 6. GPT-5를 사용하여 Manager_Agent 리포트 생성 (Agent 리포트만 종합)
    console.log('🤖 Manager_Agent (GPT-5) 통합 분석 중...');
    const managerReport = await generateManagerReportDirectly(managerPrompt, payload);
    
    console.log('✅ Manager_Agent 통합 리포트 생성 완료');
    return managerReport;
    
  } catch (error) {
    console.error('❌ Manager_Agent 리포트 생성 실패:', error);
    throw error;
  }
}

/**
 * Agent 보고서들 로드
 */
async function loadAgentReports(): Promise<{
  gpt: string;
  gemini: string;
  claude: string;
}> {
  const today = getKoreanDateString();
  const agentReportsDir = path.join(process.cwd(), 'data', 'agent_reports');

  // 해당 날짜의 가장 최신 파일을 찾는 함수
  const findLatestReport = async (agentName: string): Promise<string> => {
    try {
      const files = await fs.readdir(agentReportsDir);
      const agentFiles = files
        .filter(file => file.startsWith(today) && file.includes(`_agent_${agentName}.md`))
        .sort()
        .reverse(); // 최신 파일이 먼저 오도록 정렬

      if (agentFiles.length === 0) {
        throw new Error(`${agentName} 리포트 파일을 찾을 수 없습니다`);
      }

      const latestFile = agentFiles[0];
      console.log(`📄 ${agentName} 최신 리포트: ${latestFile}`);

      return await fs.readFile(
        path.join(agentReportsDir, latestFile),
        'utf8'
      );
    } catch (error) {
      console.warn(`⚠️ ${agentName} 리포트 로드 실패:`, error);
      return `## Agent_${agentName.toUpperCase()} 보고서\n보고서를 찾을 수 없습니다.`;
    }
  };

  try {
    const gptReport = await findLatestReport('gpt');
    const geminiReport = await findLatestReport('gemini');
    const claudeReport = await findLatestReport('claude');
    
    console.log('📋 Agent 보고서 로드 완료');
    return {
      gpt: gptReport,
      gemini: geminiReport,
      claude: claudeReport
    };
    
  } catch (error) {
    console.error('❌ Agent 보고서 로드 실패:', error);
    throw new Error('Agent 보고서들을 찾을 수 없습니다. 15:00 Agent 리포트가 먼저 생성되어야 합니다.');
  }
}

/**
 * 현재 포트폴리오 데이터 수집
 */
async function getCurrentPortfolioData(): Promise<any> {
  try {
    const [holdings, cashBalance, exchangeRate] = await Promise.all([
      getHoldings(),
      getCashBalance(),
      getCachedExchangeRate()
    ]);
    
    return {
      holdings,
      cash_usd: cashBalance,
      exchange_rate: exchangeRate
    };
  } catch (error) {
    console.error('❌ 포트폴리오 데이터 수집 실패:', error);
    throw error;
  }
}

/**
 * 현재 성과 분석 데이터
 */
async function getCurrentPerformanceData(): Promise<any> {
  try {
    const [holdings, cashBalance, exchangeRate] = await Promise.all([
      getHoldings(),
      getCashBalance(),
      getCachedExchangeRate()
    ]);

    // 보유 종목의 현재가 수집 (Agent와 동일한 방식 사용)
    const { fetchDailyPrices } = await import('./market');
    const holdingSymbols = holdings.map(h => h.symbol);
    let currentPrices: Record<string, number> = {};

    if (holdingSymbols.length > 0) {
      console.log(`📊 Manager Agent - 보유 종목 현재가 수집: ${holdingSymbols.join(', ')}`);
      try {
        const holdingPricesData = await fetchDailyPrices(holdingSymbols);
        for (const [symbol, prices] of Object.entries(holdingPricesData)) {
          if (prices && Array.isArray(prices) && prices.length > 0) {
            currentPrices[symbol] = prices[prices.length - 1].close;
            console.log(`💰 ${symbol}: $${currentPrices[symbol]}`);
          }
        }
      } catch (priceError) {
        console.warn('⚠️ 현재가 수집 실패, 빈 데이터 사용:', priceError);
      }
    }

    const performance = calculateCurrentPerformance(
      holdings,
      currentPrices,
      exchangeRate.usd_to_krw
    );

    const targetAnalysis = analyzeTargetProgress(performance);

    return {
      performance,
      targetAnalysis
    };
  } catch (error) {
    console.error('❌ 성과 데이터 수집 실패:', error);
    return {
      performance: null,
      targetAnalysis: null
    };
  }
}

/**
 * Manager_Agent 프롬프트 로드
 */
async function loadManagerPrompt(): Promise<string> {
  try {
    const promptPath = path.join(process.cwd(), 'prompts', 'promptManagerSimple.md');
    const promptContent = await fs.readFile(promptPath, 'utf8');
    
    return promptContent;
  } catch (error) {
    console.error('❌ Manager_Agent 프롬프트 로드 실패:', error);
    
    // 기본 프롬프트 사용
    return `당신은 Manager_Agent입니다. 3명의 투자 분석가(Agent_GPT, Agent_Gemini, Agent_Claude)의 보고서를 종합하여 최종 투자 의사결정을 내리는 포트폴리오 매니저입니다.

목표: 1년 내 1000만원 달성

다음 형식으로 통합 리포트를 작성하세요:
1. 현재 포트폴리오
2. 목표 달성률  
3. Agent 분석 종합
4. 최종 매매 지시사항 (구체적으로 "N주 매도/매수")
5. 리스크 관리

모든 지시사항은 즉시 실행 가능하도록 명확하고 구체적으로 작성하세요.`;
  }
}

/**
 * Manager_Agent용 페이로드 준비
 */
async function prepareManagerPayload(params: {
  agentReports: { gpt: string; gemini: string; claude: string };
  portfolioData: any;
  performanceData: any;
  managerPrompt: string;
}): Promise<any> {
  const { agentReports, portfolioData, performanceData, managerPrompt } = params;
  
  // Manager_Agent 전용 페이로드 구성
  return {
    manager_prompt: managerPrompt,
    agent_reports: {
      agent_gpt: agentReports.gpt,
      agent_gemini: agentReports.gemini,
      agent_claude: agentReports.claude
    },
    portfolio: portfolioData,
    performance: performanceData,
    market: {
      date: new Date().toISOString().split('T')[0],
      type: 'manager_integration',
      title: 'Manager_Agent 주간 통합 분석'
    },
    target: {
      goal_amount_krw: 10000000,
      target_timeframe: '1년'
    },
    instructions: {
      format: 'structured_trading_commands',
      style: 'decisive_and_actionable',
      priority: 'goal_achievement'
    }
  };
}

/**
 * Manager_Agent 전용 리포트 생성 (새로운 프롬프트 변수 구조 사용)
 */
async function generateManagerReportDirectly(prompt: string, payload: any): Promise<string> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY 환경변수가 설정되지 않았습니다');
    }

    const client = new OpenAI({ apiKey });
    const model = process.env.LLM_MODEL || 'gpt-5';

    console.log(`🤖 ${model}을 사용하여 Manager 리포트 생성 시작`);

    // 현재가 정보 추출
    const extractCurrentPrices = () => {
      const claudeReport = payload.agent_reports?.agent_claude || '';
      const priceExtraction = {
        BABA: claudeReport.match(/\| BABA.*?\|.*?\|.*?\|\s*(\d+\.\d+)/)?.[1],
        GOOGL: claudeReport.match(/\| GOOGL.*?\|.*?\|.*?\|\s*(\d+\.\d+)/)?.[1],
        NVDA: claudeReport.match(/\| NVDA.*?\|.*?\|.*?\|\s*(\d+\.\d+)/)?.[1],
        COIN: claudeReport.match(/\| COIN.*?\|.*?\|.*?\|\s*(\d+\.\d+)/)?.[1]
      };

      const validPrices: Record<string, number> = {};
      Object.entries(priceExtraction).forEach(([symbol, price]) => {
        if (price) validPrices[symbol] = parseFloat(price);
      });

      return validPrices;
    };

    // 각 Agent의 전략과 추천 종목을 구체적으로 추출
    const extractAgentData = (report: string, agentName: string) => {
      // 매매 의견 섹션 (보유 종목 분석)
      const tradingOpinionMatch = report.match(/## 2\. 매매 의견.*?(?=## 3\.|$)/s);
      const tradingOpinion = tradingOpinionMatch ? tradingOpinionMatch[0].trim() : '';

      // 고성장 추천 종목 섹션
      const recommendationMatch = report.match(/## 3\. 고성장 추천 종목.*?(?=## 4\.|$)/s);
      const recommendations = recommendationMatch ? recommendationMatch[0].trim() : '';

      // 핵심 매매 제안 한줄평 추출
      const adviceMatch = report.match(/🎯 Agent 핵심 매매 제안 & 1000만원 전략 한줄평([\s\S]*?)(?=\n추가 유의|추가 유의|$)/);
      const advice = adviceMatch ? adviceMatch[1].trim() : '';

      return {
        strategy: tradingOpinion || `Agent_${agentName} 매매 의견 정보 없음`,
        recommendations: recommendations || `Agent_${agentName} 추천 종목 정보 없음`,
        advice: advice || `Agent_${agentName} 한줄평 정보 없음`
      };
    };

    const gptData = extractAgentData(payload.agent_reports?.agent_gpt || '', 'GPT');
    const geminiData = extractAgentData(payload.agent_reports?.agent_gemini || '', 'Gemini');
    const claudeData = extractAgentData(payload.agent_reports?.agent_claude || '', 'Claude');
    const currentPrices = extractCurrentPrices();
    const availableCash = payload.portfolio.cash_usd || 0;

    // 새로운 프롬프트 변수에 맞게 템플릿 치환
    const processedPrompt = prompt
      .replace(/{gpt_strategy}/g, gptData.strategy)
      .replace(/{claude_strategy}/g, claudeData.strategy)
      .replace(/{gemini_strategy}/g, geminiData.strategy)
      .replace(/{gpt_recommendations}/g, gptData.recommendations)
      .replace(/{claude_recommendations}/g, claudeData.recommendations)
      .replace(/{gemini_recommendations}/g, geminiData.recommendations)
      .replace(/{portfolio}/g, JSON.stringify(payload.portfolio?.holdings || []))
      .replace(/{currentPrices}/g, JSON.stringify(currentPrices))
      .replace(/{exchange_rate}/g, (payload.portfolio?.exchange_rate || 'N/A').toString());

    console.log('🔄 프롬프트 변수 치환 완료');

    // Manager용 추가 컨텍스트
    const managerContext = `
**현재 상황 브리핑**:
- 현금: $${availableCash.toFixed(2)}
- 환율: ${payload.portfolio?.exchange_rate || 'N/A'}원
- 목표: 1년 내 ₩10,000,000 달성

**각 Agent 핵심 매매 제안 요약**:
- Agent_GPT: ${gptData.advice}
- Agent_Gemini: ${geminiData.advice}
- Agent_Claude: ${claudeData.advice}

**Manager 핵심 임무**:
위 3개 Agent의 전략을 독립적으로 분석하여 단순 취합이 아닌 Manager만의 최적 투자 결정을 내리세요.
Agent 간 의견이 다를 때는 명확한 중재 논리를 제시하고, 1000만원 목표 달성을 위한 구체적 전략을 수립하세요.
`;

    const messages = [
      {
        role: 'system' as const,
        content: processedPrompt
      },
      {
        role: 'user' as const,
        content: managerContext
      }
    ];

    const response = await client.chat.completions.create({
      model,
      messages,
      max_completion_tokens: 15000
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

    console.log('✅ Manager LLM 보고서 생성 완료');
    return content;

  } catch (error) {
    console.error('❌ Manager 직접 리포트 생성 중 오류:', error);
    throw error;
  }
}

/**
 * Manager_Agent 리포트 저장
 */
export async function saveManagerReport(report: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const reportDir = path.join(process.cwd(), 'data', 'report');
  
  await fs.mkdir(reportDir, { recursive: true });
  
  const mdPath = path.join(reportDir, `${today}_manager_final.md`);
  await fs.writeFile(mdPath, report, 'utf8');
  
  console.log('💾 Manager_Agent 최종 리포트 저장 완료:', mdPath);
  return mdPath;
}