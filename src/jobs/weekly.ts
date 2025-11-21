import dotenv from 'dotenv';
import { isNasdaqOpen } from '../utils/marketday';
import { db, getHoldings, getCashBalance, saveReportRecord } from '../storage/database';
import { fetchDailyPrices, computeIndicators, computeIndicatorsPartial } from '../services/market';
import { fetchNews } from '../services/news';
import { generateReport } from '../services/llm';
import { generateReportWithGemini } from '../services/gemini';
import { generateReportWithClaude } from '../services/claude';
import { generateReportWithGrok } from '../services/grok';
import { sendReportEmail, wrapInEmailTemplate } from '../services/mail';
import { generateReportFile } from '../logic/report';
import { loadSectors } from '../utils/config';
import { runFullScreening } from '../services/screening';
import { getCachedExchangeRate } from '../services/exchange';
import { calculateCurrentPerformance, analyzeTargetProgress, savePerformanceHistory, generatePerformanceReport } from '../services/performance';
import { getLatestPrices, isRealtimePriceEnabled, getCurrentMarketSession } from '../services/realtime-market';
import fs from 'fs/promises';
import path from 'path';

// 환경변수 로드
dotenv.config();

/**
 * 주간 투자 리포트 자동 생성 파이프라인
 * - 매주 금요일(미국시간) 장 마감 후 GitHub Actions로 자동 실행
 *   - 미국 동부시간: 금요일 17:00-18:00 (장 마감 후 1-2시간)
 *   - 한국시간: 토요일 새벽 07:00
 * - 4개 AI Agent (Agent_Claude, Agent_GPT, Agent_Gemini, Agent_Grok)가 각각 독립적으로 리포트 생성
 * - 미국 시장 개장일에만 실행 (금요일이 휴장이면 다음 개장일)
 * - Manager_Agent가 07:30에 통합 리포트 생성
 * - 장점: 금요일 종가 완벽 반영, 주말에 여유있게 검토, 월요일 매매 전략 수립
 */
export async function runWeekly(): Promise<void> {
  const today = new Date();
  
  console.log(`🚀 주간 리포트 파이프라인 시작: ${today.toISOString()}`);

  try {
    // 1. 미국 시장 휴장일 확인 (월요일이 휴장이면 건너뛰기)
    if (!isNasdaqOpen(today)) {
      console.log('📅 미국 시장 휴장일입니다. 다음 개장일까지 대기합니다.');
      return;
    }

    // 2. 섹터 설정 로드 (6개 섹터)
    const sectors = await loadSectors();
    console.log(`📋 ${Object.keys(sectors).length}개 섹터 로드됨 (AI, Computing, Nuclear, Technology, Aerospace, Defense)`);

    // 3. 전체 섹터 스크리닝 실행 (주간 더 상세한 분석)
    console.log('\n🔍 주간 상세 종목 스크리닝 시작...');
    const screeningResults = await runFullScreening(sectors);

    // 4. Agent별 리포트 생성 (15:00)
    console.log('\n📊 Agent별 주간 리포트 생성 시작...');
    
    try {
      await processWeeklyAgentReports(sectors, screeningResults);
      console.log('✅ Agent별 주간 리포트 생성 완료');
    } catch (error) {
      console.error('❌ Agent별 리포트 생성 실패:', error);
      throw error;
    }

    console.log('🎉 주간 Agent 리포트 파이프라인 완료');
    console.log('⏰ Manager_Agent 통합 리포트는 16:00에 별도 실행됩니다.');

  } catch (error) {
    console.error('❌ 주간 리포트 파이프라인 실패:', error);
    throw error;
  }
}

/**
 * Agent별 주간 리포트 처리 (Agent_Claude, Agent_GPT, Agent_Gemini)
 */
export async function processWeeklyAgentReports(sectors: any, screeningResults: any): Promise<void> {
  const startTime = Date.now();
  
  try {
    console.log('📊 전체 섹터 데이터 통합 중...');
    
    // 모든 섹터의 종목을 하나로 통합
    const allSymbols = new Set<string>();
    const allScreeningResults: any[] = [];
    
    for (const [sectorCode, results] of Object.entries(screeningResults)) {
      if (Array.isArray(results)) {
        for (const result of results) {
          allSymbols.add(result.symbol);
          allScreeningResults.push({
            ...result,
            sector: sectorCode
          });
        }
      }
    }
    
    const symbolsArray = Array.from(allSymbols);
    console.log(`📋 통합 종목 수: ${symbolsArray.length}개`);
    
    // 통합된 종목들의 가격 데이터 수집
    console.log('📈 주간 가격 데이터 수집 중...');
    const pricesData = await fetchDailyPrices(symbolsArray);
    
    // 통합 기술지표 계산
    console.log('📊 주간 기술지표 계산 중...');
    const indicatorsData = await calculateIndicators(pricesData);
    
    // 통합 뉴스 수집 (주간이므로 더 많은 뉴스)
    console.log('📰 주간 뉴스 수집 중...');
    const newsData = await fetchNews({
      symbols: symbolsArray,
      sector: 'weekly',
      limit: 50, // 주간 리포트이므로 더 많은 뉴스
      fromDate: getDateDaysAgo(7) // 최근 7일
    });
    
    // 보유 종목 현재가 수집 (실시간 가격)
    console.log('💰 보유 종목 실시간 가격 수집 중...');
    const holdingsForReport = await getHoldings();
    const holdingSymbols = holdingsForReport.map(h => h.symbol);
    let holdingCurrentPrices: Record<string, number> = {};
    let priceTimestamp: Date | undefined;
    let tradingSession: string | undefined;

    if (holdingSymbols.length > 0) {
      console.log(`📊 보유 종목 현재가 수집: ${holdingSymbols.join(', ')}`);

      // Alpaca 실시간 가격 조회 시도
      if (isRealtimePriceEnabled()) {
        try {
          console.log('🔄 Alpaca 실시간 가격 API 사용 중...');
          const realtimePrices = await getLatestPrices(holdingSymbols);

          for (const [symbol, priceData] of Object.entries(realtimePrices)) {
            holdingCurrentPrices[symbol] = priceData.price;
            console.log(`💰 ${symbol}: $${priceData.price} (${priceData.session})`);

            // 타임스탬프와 세션 정보 저장 (첫 번째 종목 기준)
            if (!priceTimestamp) {
              priceTimestamp = priceData.timestamp;
              tradingSession = priceData.session;
            }
          }

          const currentSession = getCurrentMarketSession();
          console.log(`✅ 실시간 가격 조회 완료 - 현재 세션: ${currentSession}`);

        } catch (error) {
          console.warn('⚠️ Alpaca 실시간 가격 조회 실패, Yahoo Finance fallback:', (error as Error).message);

          // Yahoo Finance fallback
          const holdingPricesData = await fetchDailyPrices(holdingSymbols);
          for (const [symbol, prices] of Object.entries(holdingPricesData)) {
            if (prices && prices.length > 0) {
              holdingCurrentPrices[symbol] = prices[prices.length - 1].close;
              console.log(`💰 ${symbol}: $${holdingCurrentPrices[symbol]} (종가)`);
            }
          }
        }
      } else {
        console.log('ℹ️ Alpaca API가 설정되지 않았습니다. Yahoo Finance 사용 중...');

        // Yahoo Finance 사용
        const holdingPricesData = await fetchDailyPrices(holdingSymbols);
        for (const [symbol, prices] of Object.entries(holdingPricesData)) {
          if (prices && prices.length > 0) {
            holdingCurrentPrices[symbol] = prices[prices.length - 1].close;
            console.log(`💰 ${symbol}: $${holdingCurrentPrices[symbol]} (종가)`);
          }
        }
      }
    }
    
    // 주간 리포트 페이로드 준비
    const reportPayload = await prepareWeeklyReportPayload({
      allSectors: sectors,
      symbols: symbolsArray,
      pricesData,
      indicatorsData,
      newsData,
      screeningResults: allScreeningResults,
      currentPrices: holdingCurrentPrices,
      priceTimestamp,
      tradingSession
    });
    
    // 공통 데이터 변환 (AI 리포트용)
    const stocks = allScreeningResults.map((r: any) => ({
      symbol: r.symbol,
      name: r.name || r.symbol,
      sector: r.sector_code || r.sector
    }));
    const priceData = indicatorsData;
    const news = newsData;
    const holdingsData = reportPayload.portfolio.holdings;

    // Agent_GPT 주간 리포트 생성
    console.log('🤖 Agent_GPT 주간 리포트 생성 중...');
    const agentGptReport = await generateReport(reportPayload);
    
    // Agent_Gemini 주간 리포트 생성
    let agentGeminiReport = '';
    if (process.env.GEMINI_API_KEY) {
      console.log('🤖 Agent_Gemini 주간 리포트 생성 중...');
      try {
        agentGeminiReport = await generateReportWithGemini(reportPayload);
        console.log('✅ Agent_Gemini 리포트 생성 완료');
      } catch (error) {
        console.error('❌ Agent_Gemini 리포트 생성 실패:', error);
        agentGeminiReport = '## ⚠️ Agent_Gemini 리포트\n\nGemini API 연결 문제로 리포트를 생성할 수 없습니다.';
      }
    }
    
    // Agent_Claude 주간 리포트 생성
    let agentClaudeReport = '';
    if (process.env.CLAUDE_API_KEY) {
      console.log('🤖 Agent_Claude 주간 리포트 생성 중...');
      try {
        agentClaudeReport = await generateReportWithClaude(reportPayload);
        console.log('✅ Agent_Claude 리포트 생성 완료');
      } catch (error) {
        console.error('❌ Agent_Claude 리포트 생성 실패:', error);
        agentClaudeReport = '## ⚠️ Agent_Claude 리포트\n\nClaude API 연결 문제로 리포트를 생성할 수 없습니다.';
      }
    }

    // Agent_Grok 주간 리포트 생성
    let agentGrokReport = '';
    if (process.env.GROK_API_KEY && process.env.ENABLE_GROK_REPORT === 'true') {
      console.log('🤖 Agent_Grok 주간 리포트 생성 중...');
      try {
        agentGrokReport = await generateReportWithGrok(reportPayload);
        console.log('✅ Agent_Grok 리포트 생성 완료');
      } catch (error) {
        console.error('❌ Agent_Grok 리포트 생성 실패:', error);
        agentGrokReport = '## ⚠️ Agent_Grok 리포트\n\nGrok API 연결 문제로 리포트를 생성할 수 없습니다.';
      }
    }

    // 주간 리포트 파일 저장 (Agent별)
    console.log('💾 Agent별 주간 리포트 파일 저장 중...');
    const { mdPath: gptMdPath } = await saveWeeklyReportFiles('agent_gpt', agentGptReport);
    
    let geminiMdPath = '';
    if (agentGeminiReport) {
      const { mdPath: geminiPath } = await saveWeeklyReportFiles('agent_gemini', agentGeminiReport);
      geminiMdPath = geminiPath;
    }
    
    let claudeMdPath = '';
    if (agentClaudeReport) {
      const { mdPath: claudePath } = await saveWeeklyReportFiles('agent_claude', agentClaudeReport);
      claudeMdPath = claudePath;
    }

    let grokMdPath = '';
    if (agentGrokReport) {
      const { mdPath: grokPath } = await saveWeeklyReportFiles('agent_grok', agentGrokReport);
      grokMdPath = grokPath;
    }

    // Agent별 이메일 발송 (15:00) - 순서: Claude → GPT5 → Gemini → Grok
    console.log('📧 Agent별 주간 리포트 이메일 발송 중...');
    const currentDate = new Date().toLocaleDateString('ko-KR');
    
    // 1. Agent_Claude 이메일 발송 (최우선)
    if (claudeMdPath) {
      try {
        // 저장된 파일에서 실제 리포트 내용 읽기 (fallback 메시지가 아닌 실제 생성된 리포트)
        const actualClaudeReport = await fs.readFile(claudeMdPath, 'utf8');
        
        const claudeEmailHtml = wrapInEmailTemplate(
          actualClaudeReport.replace(/\n/g, '<br>'), 
          `Agent_Claude 주간 리포트 (${currentDate})`
        );
        
        await sendReportEmail({
          subject: `📈 [IMPORTANT] Agent_Claude 주간 리포트 - ${currentDate}`,
          html: claudeEmailHtml,
          mdPath: claudeMdPath
        });
        console.log('📧 Agent_Claude 이메일 전송 완료 (저장된 파일 기준)');
      } catch (emailError) {
        console.warn('⚠️ Agent_Claude 이메일 전송 실패:', (emailError as Error).message);
      }
    }
    
    // 2. Agent_GPT 이메일 전송
    try {
      const gptEmailHtml = wrapInEmailTemplate(
        agentGptReport.replace(/\n/g, '<br>'), 
        `Agent_GPT 주간 리포트 (${currentDate})`
      );
      
      await sendReportEmail({
        subject: `🤖 Agent_GPT 주간 리포트 - ${currentDate}`,
        html: gptEmailHtml,
        mdPath: gptMdPath
      });
      console.log('📧 Agent_GPT 이메일 전송 완료');
    } catch (emailError) {
      console.warn('⚠️ Agent_GPT 이메일 전송 실패:', (emailError as Error).message);
    }
    
    // 3. Agent_Gemini 이메일 발송
    if (agentGeminiReport && geminiMdPath) {
      try {
        const geminiEmailHtml = wrapInEmailTemplate(
          agentGeminiReport.replace(/\n/g, '<br>'),
          `Agent_Gemini 주간 리포트 (${currentDate})`
        );

        await sendReportEmail({
          subject: `🤖 Agent_Gemini 주간 리포트 - ${currentDate}`,
          html: geminiEmailHtml,
          mdPath: geminiMdPath
        });
        console.log('📧 Agent_Gemini 이메일 전송 완료');
      } catch (emailError) {
        console.warn('⚠️ Agent_Gemini 이메일 전송 실패:', (emailError as Error).message);
      }
    }

    // 4. Agent_Grok 이메일 발송 (마지막)
    if (agentGrokReport && grokMdPath) {
      try {
        const grokEmailHtml = wrapInEmailTemplate(
          agentGrokReport.replace(/\n/g, '<br>'),
          `Agent_Grok 주간 리포트 (${currentDate})`
        );

        await sendReportEmail({
          subject: `🤖 Agent_Grok 주간 리포트 - ${currentDate}`,
          html: grokEmailHtml,
          mdPath: grokMdPath
        });
        console.log('📧 Agent_Grok 이메일 전송 완료');
      } catch (emailError) {
        console.warn('⚠️ Agent_Grok 이메일 전송 실패:', (emailError as Error).message);
      }
    }

    console.log('✅ Agent별 주간 리포트 처리 완료 (data/report 폴더에 저장됨)');

  } catch (error) {
    console.error('❌ Agent별 주간 리포트 처리 실패:', error);
    throw error;
  }
}

/**
 * 주간 리포트용 페이로드 준비
 */
async function prepareWeeklyReportPayload(params: {
  allSectors: any;
  symbols: string[];
  pricesData: Record<string, any[]>;
  indicatorsData: Record<string, any>;
  newsData: any[];
  screeningResults: any[];
  currentPrices?: Record<string, number>;
  priceTimestamp?: Date;
  tradingSession?: string;
}): Promise<any> {
  const { allSectors, symbols, indicatorsData, newsData, screeningResults = [] } = params;
  
  // 실제 포트폴리오 데이터 및 실시간 환율 조회
  const [holdings, cashBalance, exchangeRate] = await Promise.all([
    getHoldings(),
    getCashBalance(),
    getCachedExchangeRate()
  ]);

  const portfolio = {
    cash_usd: cashBalance,
    holdings: holdings
  };

  // 스크리닝 결과에서 점수 추출 및 섹터별 분류
  const scores: Record<string, number> = {};
  const symbolsBySector: Record<string, string[]> = {};
  
  for (const result of screeningResults) {
    scores[result.symbol] = result.overall_score;
    
    if (!symbolsBySector[result.sector]) {
      symbolsBySector[result.sector] = [];
    }
    symbolsBySector[result.sector].push(result.symbol);
  }

  // 성과 추적 및 분석 (주간 상세 분석)
  let performanceReport = '';
  try {
    console.log('📊 주간 포트폴리오 성과 분석 중...');
    
    // 보유 종목 심볼 추출
    const holdingSymbols = holdings.map(h => h.symbol);
    console.log(`💼 보유 종목: ${holdingSymbols.join(', ')}`);
    
    // 보유 종목의 현재가 데이터 조회
    const holdingPricesData = await fetchDailyPrices(holdingSymbols);
    
    // 현재가 데이터 추출
    const currentPrices: Record<string, number> = {};
    
    // 분석 종목 현재가
    for (const [symbol, indicator] of Object.entries(indicatorsData)) {
      if (indicator && indicator.close) {
        currentPrices[symbol] = indicator.close;
      }
    }
    
    // 보유 종목 현재가 (최우선)
    for (const [symbol, priceHistory] of Object.entries(holdingPricesData)) {
      if (priceHistory.length > 0) {
        const latestPrice = priceHistory[priceHistory.length - 1];
        currentPrices[symbol] = latestPrice.close;
        console.log(`💰 ${symbol} 현재가: $${latestPrice.close.toFixed(2)}`);
      }
    }
    
    // 성과 계산
    const performance = calculateCurrentPerformance(
      holdings,
      currentPrices,
      exchangeRate.usd_to_krw
    );
    
    // 목표 분석
    const targetAnalysis = analyzeTargetProgress(performance);
    
    // 성과 데이터 저장
    await savePerformanceHistory(performance);
    
    // 성과 리포트 생성
    performanceReport = generatePerformanceReport(performance, targetAnalysis);
    
    console.log(`📈 주간 성과 추적 완료: 현재 ₩${performance.current_value_krw.toLocaleString()} (${performance.total_return_percent > 0 ? '+' : ''}${performance.total_return_percent}%)`);
    
  } catch (error) {
    console.error('❌ 주간 성과 분석 실패:', error);
    performanceReport = '\n## ⚠️ 성과 분석 오류\n데이터를 불러오는 중 문제가 발생했습니다.\n';
  }

  return {
    lookback_days: 7, // 주간 리포트는 7일
    portfolio,
    market: {
      date: new Date().toISOString().split('T')[0],
      sector_code: 'weekly',
      sector_title: '주간 종합 시장 분석',
      exchange_rate: exchangeRate,
      sectors: allSectors,
      symbols_by_sector: symbolsBySector
    },
    indicators: indicatorsData,
    news: newsData.slice(0, 20), // 주간 리포트는 상위 20개 뉴스
    scores,
    performanceReport,
    total_symbols_count: symbols.length,
    screening_results: screeningResults,
    currentPrices: params.currentPrices || {},
    priceTimestamp: params.priceTimestamp ? params.priceTimestamp.toISOString() : undefined,
    tradingSession: params.tradingSession,
    report_type: 'weekly' // 주간 리포트 표시
  };
}

/**
 * 기술지표 계산 (모든 심볼)
 * - 50일 이상: 전체 지표 계산 (EMA20, EMA50, RSI14)
 * - 20-49일: 부분 지표 계산 (EMA20, RSI14)
 * - 15-19일: RSI14만 계산
 * - 15일 미만: Alpaca API로 히스토리 데이터 보완 시도
 */
async function calculateIndicators(pricesData: Record<string, any[]>): Promise<Record<string, any>> {
  const indicators: Record<string, any> = {};
  const missingDataSymbols: string[] = []; // 데이터 부족 종목 목록

  // 1차: Yahoo Finance 데이터로 기술지표 계산
  for (const [symbol, prices] of Object.entries(pricesData)) {
    try {
      const closePrices = prices.map(p => p.close);
      const currentPrice = closePrices[closePrices.length - 1];

      if (prices.length >= 50) {
        // 완전한 기술지표 계산
        const computed = computeIndicators(closePrices);
        indicators[symbol] = {
          close: currentPrice,
          ...computed
        };
        console.log(`✅ ${symbol}: 전체 기술지표 계산 완료 (${prices.length}일)`);
      } else if (prices.length >= 15) {
        // 부분 기술지표 계산
        const computed = computeIndicatorsPartial(closePrices);
        if (computed) {
          indicators[symbol] = {
            close: currentPrice,
            ...computed
          };
          const availableIndicators = Object.keys(computed).join(', ');
          console.log(`⚠️ ${symbol}: 부분 기술지표 계산 완료 (${prices.length}일, ${availableIndicators})`);
        } else {
          // 지표 계산 실패, 현재가만 제공
          indicators[symbol] = {
            close: currentPrice
          };
          console.warn(`⚠️ ${symbol}: 현재가만 제공 (${prices.length}일) - Alpaca 보완 시도 예정`);
          missingDataSymbols.push(symbol);
        }
      } else {
        // 데이터 부족, 현재가만 제공
        indicators[symbol] = {
          close: currentPrice
        };
        console.warn(`⚠️ ${symbol}: 기술지표 계산 불가 (${prices.length}일) - Alpaca 보완 시도 예정`);
        missingDataSymbols.push(symbol);
      }
    } catch (error) {
      console.error(`❌ ${symbol} 기술지표 계산 실패:`, error);
      // 오류 발생 시에도 현재가는 제공하고, 보완 목록에 추가
      if (prices.length > 0) {
        indicators[symbol] = {
          close: prices[prices.length - 1].close
        };
        missingDataSymbols.push(symbol);
      }
    }
  }

  // 2차: Alpaca API로 데이터 부족 종목 보완
  if (missingDataSymbols.length > 0 && isRealtimePriceEnabled()) {
    console.log(`\n🔄 Alpaca API로 ${missingDataSymbols.length}개 종목 기술지표 보완 시도...`);
    console.log(`   대상 종목: ${missingDataSymbols.join(', ')}`);

    try {
      const { getBulkHistoricalPrices } = await import('../services/realtime-market');
      const alpacaHistoricalData = await getBulkHistoricalPrices(missingDataSymbols, 100);

      for (const symbol of missingDataSymbols) {
        const alpacaPrices = alpacaHistoricalData[symbol];

        if (alpacaPrices && alpacaPrices.length >= 50) {
          try {
            const closePrices = alpacaPrices.map(p => p.close);
            const currentPrice = closePrices[closePrices.length - 1];

            // 완전한 기술지표 계산
            const computed = computeIndicators(closePrices);
            indicators[symbol] = {
              close: currentPrice,
              ...computed
            };
            console.log(`✅ ${symbol}: Alpaca 데이터로 전체 기술지표 계산 완료 (${alpacaPrices.length}일)`);
          } catch (error) {
            console.error(`❌ ${symbol}: Alpaca 데이터로 기술지표 계산 실패`, error);
          }
        } else if (alpacaPrices && alpacaPrices.length >= 15) {
          try {
            const closePrices = alpacaPrices.map(p => p.close);
            const currentPrice = closePrices[closePrices.length - 1];

            // 부분 기술지표 계산
            const computed = computeIndicatorsPartial(closePrices);
            if (computed) {
              indicators[symbol] = {
                close: currentPrice,
                ...computed
              };
              const availableIndicators = Object.keys(computed).join(', ');
              console.log(`✅ ${symbol}: Alpaca 데이터로 부분 기술지표 계산 완료 (${alpacaPrices.length}일, ${availableIndicators})`);
            }
          } catch (error) {
            console.error(`❌ ${symbol}: Alpaca 데이터로 부분 기술지표 계산 실패`, error);
          }
        } else {
          console.warn(`⚠️ ${symbol}: Alpaca 데이터도 부족 (${alpacaPrices?.length || 0}일)`);
        }
      }

      console.log(`✅ Alpaca 보완 완료\n`);
    } catch (error) {
      console.error('❌ Alpaca 데이터 보완 실패:', error);
    }
  } else if (missingDataSymbols.length > 0) {
    console.warn(`⚠️ Alpaca API가 설정되지 않아 ${missingDataSymbols.length}개 종목 기술지표 보완 불가`);
  }

  return indicators;
}

/**
 * 주간 리포트 파일 저장
 */
async function saveWeeklyReportFiles(agentType: string, report: string): Promise<{mdPath: string, htmlPath: string}> {
  const today = getKoreanDateTimeString();
  const reportDir = path.join(process.cwd(), 'data', 'report');
  
  // 디렉토리 생성
  await fs.mkdir(reportDir, { recursive: true });
  
  const mdPath = path.join(reportDir, `${today}_weekly_${agentType}.md`);
  const htmlPath = path.join(reportDir, `${today}_weekly_${agentType}.html`);
  
  // 마크다운 파일 저장
  await fs.writeFile(mdPath, report, 'utf8');
  
  // HTML 파일 저장 (간단한 변환)
  const html = wrapInEmailTemplate(
    report.replace(/\n/g, '<br>'),
    `${agentType.toUpperCase()} 주간 리포트 (${today})`
  );
  await fs.writeFile(htmlPath, html, 'utf8');
  
  return { mdPath, htmlPath };
}

/**
 * N일 전 날짜 문자열 반환
 */
function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

/**
 * 한국 시간 기준 날짜 문자열 생성 (YYYYMMDD 형식)
 */
function getKoreanDateString(): string {
  const now = new Date();
  const koreanTime = new Date(now.getTime() + (9 * 60 * 60 * 1000)); // UTC + 9시간
  return koreanTime.toISOString().split('T')[0].replace(/-/g, '');
}

/**
 * 한국 시간 기준 날짜+시간 문자열 생성 (YYYYMMDD_HHMM 형식)
 */
function getKoreanDateTimeString(): string {
  const now = new Date();
  const koreanTime = new Date(now.getTime() + (9 * 60 * 60 * 1000)); // UTC + 9시간
  const isoString = koreanTime.toISOString();
  const datePart = isoString.split('T')[0].replace(/-/g, '');
  const timePart = isoString.split('T')[1].substring(0, 5).replace(':', '');
  return `${datePart}_${timePart}`;
}