import { generateReport } from './llm';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
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
 * Agent 보고서들과 과거 Manager 보고서들 로드
 */
async function loadAgentReports(): Promise<{
  gpt: string;
  claude: string;
  previousManagerReports: string[];
}> {
  const agentReportsDir = path.join(process.cwd(), 'data', 'report');

  // 해당 날짜의 가장 최신 파일을 찾는 함수
  const findLatestReport = async (agentName: string, required: boolean = true): Promise<string> => {
    try {
      const files = await fs.readdir(agentReportsDir);
      const agentFiles = files
        .filter(file => file.includes(`_weekly_agent_${agentName}.md`))
        .map(file => {
          const match = file.match(/^(\d{8})(?:_(\d{4}))?_weekly_agent/);
          if (match) {
            const dateStr = match[1]; // YYYYMMDD
            const timeStr = match[2] || '0000'; // HHMM
            const sortKey = `${dateStr}_${timeStr}`;
            return { file, sortKey };
          }
          return { file, sortKey: '00000000_0000' };
        })
        .sort((a, b) => b.sortKey.localeCompare(a.sortKey)); // 최신순 (내림차순)

      if (agentFiles.length === 0) {
        if (required) {
          throw new Error(`${agentName} 리포트 파일을 찾을 수 없습니다`);
        } else {
          console.warn(`⚠️ ${agentName} 리포트 파일을 찾을 수 없습니다 (선택적 Agent)`);
          return `## Agent_${agentName.toUpperCase()} 보고서\n\n아직 생성되지 않았습니다. 첫 번째 weekly 리포트 실행을 기다려주세요.`;
        }
      }

      const latestFile = agentFiles[0].file;
      console.log(`📄 ${agentName} 최신 리포트: ${latestFile} (sortKey: ${agentFiles[0].sortKey})`);

      return await fs.readFile(
        path.join(agentReportsDir, latestFile),
        'utf8'
      );
    } catch (error) {
      console.warn(`⚠️ ${agentName} 리포트 로드 실패:`, error);
      if (required) {
        return `## Agent_${agentName.toUpperCase()} 보고서\n\n보고서를 찾을 수 없습니다.`;
      } else {
        return `## Agent_${agentName.toUpperCase()} 보고서\n\n아직 생성되지 않았습니다.`;
      }
    }
  };

  // 과거 Manager 보고서들 로드
  const loadPreviousManagerReports = async (): Promise<string[]> => {
    try {
      const files = await fs.readdir(agentReportsDir);
      const managerFiles = files
        .filter(file => file.includes('_manager_final.md'))
        .sort()
        .reverse(); // 최신부터 정렬

      console.log(`📚 발견된 과거 Manager 보고서: ${managerFiles.length}개`);

      const reports: string[] = [];
      // 최대 3개의 과거 보고서만 로드 (토큰 효율성)
      const reportsToLoad = managerFiles.slice(0, 3);

      for (const file of reportsToLoad) {
        try {
          const content = await fs.readFile(
            path.join(agentReportsDir, file),
            'utf8'
          );
          reports.push(`### ${file}\n${content}\n---\n`);
          console.log(`📄 과거 Manager 보고서 로드: ${file}`);
        } catch (error) {
          console.warn(`⚠️ Manager 보고서 로드 실패: ${file}`, error);
        }
      }

      return reports;
    } catch (error) {
      console.warn('⚠️ 과거 Manager 보고서 디렉토리 접근 실패:', error);
      return [];
    }
  };

  try {
    const [gptReport, claudeReport, previousManagerReports] = await Promise.all([
      findLatestReport('gpt', true),      // 필수 Agent
      findLatestReport('claude', true),   // 필수 Agent
      loadPreviousManagerReports()
    ]);

    console.log('📋 Agent 보고서 및 과거 Manager 보고서 로드 완료');
    console.log(`📚 과거 Manager 보고서 ${previousManagerReports.length}개 로드됨`);

    return {
      gpt: gptReport,
      claude: claudeReport,
      previousManagerReports
    };

  } catch (error) {
    console.error('❌ 보고서 로드 실패:', error);
    throw new Error('필수 Agent 보고서들(GPT, Claude)을 찾을 수 없습니다. 15:00 Agent 리포트가 먼저 생성되어야 합니다.');
  }
}

/**
 * 현재 포트폴리오 데이터 수집
 */
async function getCurrentPortfolioData(): Promise<any> {
  try {
    const { getOpenPositions } = await import('../storage/positions');
    const [holdings, cashBalance, exchangeRate, positions] = await Promise.all([
      getHoldings(),
      getCashBalance(),
      getCachedExchangeRate(),
      getOpenPositions().catch(() => [])  // 계획 정보 (진입시각·SL/TP·근거)
    ]);

    // 토스 보유(진실)에 앱 계획(의도)을 병합 — Manager가 보유 맥락으로 판단하도록.
    // opened_at으로 보유 일수를 계산해 "며칠째 보유 중인지"까지 전달한다.
    const planBySymbol = new Map(positions.map((p: any) => [p.symbol, p]));
    const now = Date.now();
    const enriched = holdings.map(h => {
      const plan: any = planBySymbol.get(h.symbol) || {};
      const heldDays = plan.opened_at
        ? Math.max(0, Math.floor((now - new Date(plan.opened_at).getTime()) / 86400000))
        : null;
      return {
        symbol: h.symbol,
        shares: h.shares,
        avg_cost: h.avg_cost,
        currency: h.currency,
        opened_at: plan.opened_at || null,
        held_days: heldDays,             // 보유 일수 (없으면 null)
        stop_loss: plan.stop_loss ?? null,
        take_profit_1: plan.take_profit_1 ?? null,
        take_profit_2: plan.take_profit_2 ?? null,
        tp1_done: plan.tp1_done ?? false,
        time_horizon: plan.time_horizon || null,
        rationale: plan.rationale || null,   // 최초 매수 근거
        source_report_id: plan.source_report_id || null
      };
    });

    return {
      holdings: enriched,
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

    // 보유 종목의 실시간 가격 수집
    const { fetchDailyPrices } = await import('./market');
    const { getLatestPrices, isRealtimePriceEnabled } = await import('./realtime-market');
    const holdingSymbols = holdings.map(h => h.symbol);
    let currentPrices: Record<string, number> = {};

    if (holdingSymbols.length > 0) {
      console.log(`📊 Manager Agent - 보유 종목 실시간 가격 수집: ${holdingSymbols.join(', ')}`);

      // 토스 실시간 가격 조회 시도
      if (isRealtimePriceEnabled()) {
        try {
          console.log('🔄 Manager Agent - 토스 실시간 가격 API 사용 중...');
          const realtimePrices = await getLatestPrices(holdingSymbols);

          for (const [symbol, priceData] of Object.entries(realtimePrices)) {
            currentPrices[symbol] = priceData.price;
            console.log(`💰 ${symbol}: $${priceData.price} (${priceData.session})`);
          }
        } catch (priceError) {
          console.warn('⚠️ 토스 실시간 가격 조회 실패, 일봉 종가 fallback:', priceError);

          // 일봉 종가 fallback
          try {
            const holdingPricesData = await fetchDailyPrices(holdingSymbols);
            for (const [symbol, prices] of Object.entries(holdingPricesData)) {
              if (prices && Array.isArray(prices) && prices.length > 0) {
                currentPrices[symbol] = prices[prices.length - 1].close;
                console.log(`💰 ${symbol}: $${currentPrices[symbol]} (종가)`);
              }
            }
          } catch (fallbackError) {
            console.warn('⚠️ 현재가 수집 완전 실패, 빈 데이터 사용:', fallbackError);
          }
        }
      } else {
        console.log('ℹ️ Manager Agent - 토스 API가 설정되지 않았습니다. 일봉 종가 사용 중...');

        // 일봉 종가 사용
        try {
          const holdingPricesData = await fetchDailyPrices(holdingSymbols);
          for (const [symbol, prices] of Object.entries(holdingPricesData)) {
            if (prices && Array.isArray(prices) && prices.length > 0) {
              currentPrices[symbol] = prices[prices.length - 1].close;
              console.log(`💰 ${symbol}: $${currentPrices[symbol]} (종가)`);
            }
          }
        } catch (priceError) {
          console.warn('⚠️ 현재가 수집 실패, 빈 데이터 사용:', priceError);
        }
      }
    }

    const performance = calculateCurrentPerformance(
      holdings,
      currentPrices,
      exchangeRate.usd_to_krw,
      undefined,
      undefined,
      cashBalance // 현금 포함 총자산 기준
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
    return `당신은 Manager_Agent입니다. 2명의 투자 분석가(Agent_GPT, Agent_Claude)의 보고서를 종합하여 최종 투자 의사결정을 내리는 포트폴리오 매니저입니다.

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
  agentReports: { gpt: string; claude: string; previousManagerReports: string[] };
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
      agent_claude: agentReports.claude
    },
    previous_manager_reports: agentReports.previousManagerReports,
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
    // Manager Agent 모델 설정 (환경변수 우선, 기본 Claude Opus 4.8)
    const managerModel = process.env.MANAGER_MODEL || 'claude-opus-4-8';
    const isClaudeModel = managerModel.includes('claude');

    // API 키 및 클라이언트 타입 결정
    let apiKey: string;
    let clientType: 'anthropic' | 'openai';

    if (isClaudeModel) {
      apiKey = process.env.CLAUDE_API_KEY || '';
      clientType = 'anthropic';
      if (!apiKey) {
        throw new Error('CLAUDE_API_KEY 환경변수가 설정되지 않았습니다');
      }
    } else {
      apiKey = process.env.OPENAI_API_KEY || '';
      clientType = 'openai';
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY 환경변수가 설정되지 않았습니다');
      }
    }

    console.log(`🤖 Manager Agent - ${managerModel}을 사용하여 리포트 생성 시작 (API: ${clientType})`);

    // 현재가 정보 수집 (실보유 종목 기준 토스 실시간 조회 — 하드코딩·리포트 스크래핑 금지)
    const extractCurrentPrices = async (): Promise<Record<string, number>> => {
      try {
        const holdings: Array<{ symbol: string }> = payload.portfolio?.holdings || [];
        const symbols = holdings.map(h => h.symbol);
        if (symbols.length === 0) return {};

        const { getPrices } = await import('./toss');
        return await getPrices(symbols);
      } catch (error) {
        console.warn('⚠️ 현재가 수집 실패, 빈 데이터로 진행:', error);
        return {};
      }
    };

    // 에이전트 분석 메모 전달
    // - 메모는 이미 Manager 취합용 압축 형식(≤1,500토큰)이므로 섹션 추출 없이 전문을 전달한다.
    //   (과거 리포트 형식의 섹션 제목을 정규식으로 긁던 방식은 형식 변경에 깨져서 폐기 —
    //    2026-07-13 첫 실전에서 "의견 데이터 전무" 오판의 원인이 됐음)
    const extractAgentData = (report: string, agentName: string) => {
      const memo = (report || '').trim();
      console.log(`📋 ${agentName} 메모 길이: ${memo.length}자`);
      return {
        strategy: memo || `Agent_${agentName} 분석 메모 없음 (생성 실패)`,
        recommendations: memo ? '(위 분석 메모의 "신규 매수 추천" 섹션 참조)' : `Agent_${agentName} 추천 정보 없음`,
        advice: ''
      };
    };

    const gptData = extractAgentData(payload.agent_reports?.agent_gpt || '', 'GPT');
    const claudeData = extractAgentData(payload.agent_reports?.agent_claude || '', 'Claude');

    // 추출 결과 상세 디버깅
    console.log('🔍 Claude 전략 첫 200자:', claudeData.strategy.substring(0, 200));
    console.log('🔍 Claude 추천 첫 200자:', claudeData.recommendations.substring(0, 200));
    console.log('🔍 GPT 전략 첫 200자:', gptData.strategy.substring(0, 200));
    console.log('🔍 GPT 추천 첫 200자:', gptData.recommendations.substring(0, 200));
    const currentPrices = await extractCurrentPrices();
    const availableCash = payload.portfolio.cash_usd || 0;

    // 새로운 프롬프트 변수에 맞게 템플릿 치환
    // 환율 디버깅 - 먼저 실행
    const exchangeRateValue = (() => {
      const exchangeRate = payload.portfolio?.exchange_rate;
      console.log('🔍 환율 원본 데이터:', exchangeRate);
      console.log('🔍 환율 타입:', typeof exchangeRate);

      if (typeof exchangeRate === 'number') {
        console.log('🔍 환율 처리: 숫자형');
        return exchangeRate.toString();
      } else if (exchangeRate && typeof exchangeRate === 'object' && 'usd_to_krw' in exchangeRate) {
        console.log('🔍 환율 처리: 객체형, usd_to_krw =', exchangeRate.usd_to_krw);
        return exchangeRate.usd_to_krw.toString();
      } else {
        console.log('🔍 환율 처리: 기본값 1392 사용');
        return '1392';
      }
    })();
    console.log('🔍 환율 디버깅:', {
      raw: payload.portfolio?.exchange_rate,
      type: typeof payload.portfolio?.exchange_rate,
      processed: exchangeRateValue
    });

    const processedPrompt = prompt
      .replace(/{gpt_strategy}/g, gptData.strategy)
      .replace(/{claude_strategy}/g, claudeData.strategy)
      .replace(/{gpt_recommendations}/g, gptData.recommendations)
      .replace(/{claude_recommendations}/g, claudeData.recommendations)
      .replace(/{portfolio}/g, JSON.stringify(payload.portfolio?.holdings || []))
      .replace(/{currentPrices}/g, JSON.stringify(currentPrices))
      .replace(/{exchange_rate}/g, exchangeRateValue);

    console.log('🔄 프롬프트 변수 치환 완료');

    // 과거 Manager 보고서 요약 생성
    const previousReportsSummary = (() => {
      const reports = payload.previous_manager_reports || [];
      if (reports.length === 0) {
        return "과거 Manager 보고서 없음 (첫 실행)";
      }

      console.log(`📚 과거 Manager 보고서 ${reports.length}개 컨텍스트에 포함`);
      return reports.join('\n');
    })();

    // Manager용 추가 컨텍스트
    const managerContext = `
**현재 상황 브리핑**:
- 현금: $${availableCash.toFixed(2)}
- 환율: ${payload.portfolio?.exchange_rate || 'N/A'}원
- 목표: 1년 내 $8,000 달성

**과거 Manager 투자 결정 이력** (최근 3개):
${previousReportsSummary}

**Manager 핵심 임무**:
1. 위 2개 Agent(GPT, Claude)의 분석 메모를 독립적으로 검토하여 단순 취합이 아닌 Manager만의 최적 투자 결정을 내리세요.
2. 과거 Manager 보고서들의 투자 결정과 그 결과를 참고하여 일관성 있는 전략을 수립하세요.
3. Agent 간 의견이 다를 때는 명확한 중재 논리를 제시하고, $8,000 목표 달성을 위한 구체적 전략을 수립하세요.
4. 과거 실패한 투자 결정이 있다면 그 원인을 분석하고 개선된 접근 방식을 제시하세요.
`;

    // API별 클라이언트 및 호출 방식 분기
    let content: string;

    if (clientType === 'anthropic') {
      // Anthropic API 사용 (Claude 모델)
      const anthropicClient = new Anthropic({ apiKey });

      console.log('📡 Anthropic API 호출 중...');
      // 분량: 프롬프트에서 3,000토큰 이내로 지시. 캡은 여유를 둔 안전망 —
      // 리포트 맨 끝의 결정 JSON이 잘리면 자동매매 입력이 사라지므로 타이트하게 조이지 않는다.
      const anthropicResponse = await anthropicClient.messages.create({
        model: managerModel,
        max_tokens: 12000,
        system: processedPrompt,
        messages: [
          {
            role: 'user',
            content: managerContext
          }
        ]
      });

      console.log('📊 Anthropic 응답 구조 디버깅:', {
        content_length: anthropicResponse.content?.length || 0,
        stop_reason: anthropicResponse.stop_reason
      });

      const textContent = anthropicResponse.content.find(c => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('Anthropic API로부터 빈 응답을 받았습니다');
      }
      content = textContent.text;

    } else {
      // OpenAI API 사용 (GPT 모델)
      const openaiClient = new OpenAI({ apiKey });

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

      console.log('📡 OpenAI API 호출 중...');
      const openaiResponse = await openaiClient.chat.completions.create({
        model: managerModel,
        messages,
        max_completion_tokens: 15000
      });

      console.log('📊 OpenAI 응답 구조 디버깅:', {
        choices_length: openaiResponse.choices?.length || 0,
        first_choice: openaiResponse.choices?.[0] ? {
          message_exists: !!openaiResponse.choices[0].message,
          content_length: openaiResponse.choices[0].message?.content?.length || 0,
          finish_reason: openaiResponse.choices[0].finish_reason
        } : null
      });

      const responseContent = openaiResponse.choices[0]?.message?.content;
      if (!responseContent) {
        throw new Error('OpenAI API로부터 빈 응답을 받았습니다');
      }
      content = responseContent;
    }

    // 리포트 메타데이터 헤더 생성
    const currentDate = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const modelProvider = clientType === 'anthropic' ? 'Anthropic Claude' : 'OpenAI GPT';
    const reportHeader = `# 🏢 Manager_Agent 최종 통합 리포트

---

## 📋 리포트 메타데이터

**생성 일시**: ${currentDate}
**사용 모델**: ${managerModel} (${modelProvider})

### 참조한 Agent 보고서

✅ **Agent_GPT**: ${payload.agent_reports?.agent_gpt ? `${(payload.agent_reports.agent_gpt.length / 1000).toFixed(1)}K 자` : '없음'}
✅ **Agent_Claude**: ${payload.agent_reports?.agent_claude ? `${(payload.agent_reports.agent_claude.length / 1000).toFixed(1)}K 자` : '없음'}

### 과거 Manager 보고서

📚 **참조한 과거 리포트**: ${payload.previous_manager_reports?.length || 0}개

---

`;

    console.log('✅ Manager LLM 보고서 생성 완료');
    return reportHeader + content;

  } catch (error) {
    console.error('❌ Manager 직접 리포트 생성 중 오류:', error);
    throw error;
  }
}

/**
 * Manager_Agent 리포트 저장
 */
export async function saveManagerReport(report: string): Promise<string> {
  // 한국 시간 기준으로 날짜와 시간 생성 (YYYYMMDD_HHMM 형식)
  const now = new Date();
  const koreanTime = new Date(now.getTime() + (9 * 60 * 60 * 1000)); // UTC + 9시간
  const dateStr = koreanTime.toISOString().split('T')[0].replace(/-/g, '');
  const timeStr = koreanTime.toISOString().split('T')[1].substring(0, 5).replace(':', '');
  const timestamp = `${dateStr}_${timeStr}`;

  const reportDir = path.join(process.cwd(), 'data', 'report');

  await fs.mkdir(reportDir, { recursive: true });

  const mdPath = path.join(reportDir, `${timestamp}_manager_final.md`);
  await fs.writeFile(mdPath, report, 'utf8');

  console.log('💾 Manager_Agent 최종 리포트 저장 완료:', mdPath);
  return mdPath;
}