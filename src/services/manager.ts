import { generateReport } from './llm';
import { getHoldings, getCashBalance } from '../storage/database';
import { getCachedExchangeRate } from './exchange';
import { calculateCurrentPerformance, analyzeTargetProgress } from './performance';
import fs from 'fs/promises';
import path from 'path';

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
    const portfolioData = await getCurrentPortfolioData();
    
    // 3. 성과 분석 데이터
    const performanceData = await getCurrentPerformanceData();
    
    // 4. Manager_Agent 프롬프트 로드
    const managerPrompt = await loadManagerPrompt();
    
    // 5. 통합 분석 페이로드 준비
    const payload = await prepareManagerPayload({
      agentReports,
      portfolioData,
      performanceData,
      managerPrompt
    });
    
    // 6. GPT-5를 사용하여 Manager_Agent 리포트 생성
    console.log('🤖 Manager_Agent (GPT-5) 통합 분석 중...');
    const managerReport = await generateReport(payload);
    
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
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const agentReportsDir = path.join(process.cwd(), 'data', 'agent_reports');
  
  try {
    const gptReport = await fs.readFile(
      path.join(agentReportsDir, `${today}_agent_gpt.md`),
      'utf8'
    );
    
    let geminiReport = '';
    try {
      geminiReport = await fs.readFile(
        path.join(agentReportsDir, `${today}_agent_gemini.md`),
        'utf8'
      );
    } catch {
      geminiReport = '## Agent_Gemini 보고서\\n보고서를 찾을 수 없습니다.';
    }
    
    let claudeReport = '';
    try {
      claudeReport = await fs.readFile(
        path.join(agentReportsDir, `${today}_agent_claude.md`),
        'utf8'
      );
    } catch {
      claudeReport = '## Agent_Claude 보고서\\n보고서를 찾을 수 없습니다.';
    }
    
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
    
    // 현재가는 Agent 보고서에서 추출하거나 별도 조회 필요
    // 여기서는 간단히 기본값 사용
    const currentPrices: Record<string, number> = {};
    
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
    const promptPath = path.join(process.cwd(), 'promptManager.md');
    const promptContent = await fs.readFile(promptPath, 'utf8');
    
    // 프롬프트에서 실제 사용할 부분만 추출
    const promptStart = promptContent.indexOf('당신은 **Manager_Agent**입니다.');
    if (promptStart === -1) {
      throw new Error('Manager_Agent 프롬프트를 찾을 수 없습니다.');
    }
    
    return promptContent.substring(promptStart);
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