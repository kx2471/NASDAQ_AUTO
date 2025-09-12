import dotenv from 'dotenv';
import { isNasdaqOpen } from '../utils/marketday';
import { db, getHoldings, getCashBalance } from '../storage/database';
import { fetchDailyPrices, computeIndicators } from '../services/market';
import { fetchNews } from '../services/news';
import { generateReport } from '../services/llm';
import { sendReportEmail, wrapInEmailTemplate } from '../services/mail';
import { generateReportFile } from '../logic/report';
import { loadSectors } from '../utils/config';
import { runFullScreening } from '../services/screening';
import { getCachedExchangeRate } from '../services/exchange';

// 환경변수 로드
dotenv.config();
import { calculateCurrentPerformance, analyzeTargetProgress, savePerformanceHistory, generatePerformanceReport } from '../services/performance';
import fs from 'fs/promises';
import path from 'path';

/**
 * 데일리 파이프라인 실행
 * 한국시간 16:00 (미국 시장 개장일에만)
 */
export async function runDaily(): Promise<void> {
  const today = new Date();
  
  console.log(`🚀 데일리 파이프라인 시작: ${today.toISOString()}`);

  try {
    // 1. 미국 시장 휴장일 확인
    if (!isNasdaqOpen(today)) {
      console.log('📅 미국 시장 휴장일입니다. 파이프라인을 건너뜁니다.');
      return;
    }

    // 2. 섹터 설정 로드
    const sectors = await loadSectors();
    console.log(`📋 ${Object.keys(sectors).length}개 섹터 로드됨`);

    // 전체 섹터 스크리닝 실행 (동적 종목 발견 + 분석)
    console.log('\n🔍 동적 종목 스크리닝 시작...');
    const screeningResults = await runFullScreening(sectors);

    // 통합 리포트 생성 (모든 섹터 데이터 종합)
    console.log('\n📊 통합 리포트 생성 시작...');
    
    try {
      await processUnifiedReport(sectors, screeningResults);
      console.log('✅ 통합 리포트 생성 완료');
    } catch (error) {
      console.error('❌ 통합 리포트 생성 실패:', error);
      throw error;
    }

    console.log('🎉 데일리 파이프라인 완료');

  } catch (error) {
    console.error('❌ 데일리 파이프라인 실패:', error);
    throw error;
  }
}

/**
 * 개별 섹터 처리
 */
async function processSector(
  sectorCode: string, 
  sectorConfig: any,
  screeningResults: any[] = []
): Promise<void> {
  const { title: sectorTitle } = sectorConfig;
  
  // 스크리닝 결과에서 종목 심볼 추출
  const symbols = screeningResults.map(result => result.symbol);
  
  try {
    // 3. 가격 데이터 수집
    console.log(`📈 가격 데이터 수집 중... (${symbols.length}개 종목)`);
    const pricesData = await fetchDailyPrices(symbols);

    // 4. 기술지표 계산
    console.log('📊 기술지표 계산 중...');
    const indicatorsData = await calculateIndicators(pricesData);

    // 5. 뉴스 수집
    console.log('📰 뉴스 수집 중...');
    const newsData = await fetchNews({
      symbols,
      sector: sectorCode,
      limit: 20,
      fromDate: getDateDaysAgo(7) // 최근 7일
    });

    // 6. 보유 현황 새로고침 (JSON에서는 실시간 계산)
    console.log('💰 포트폴리오 데이터 계산 중...');

    // 6.5. 보유 종목의 현재가 데이터 수집 (리포트에서 사용하기 위함)
    const holdings = await getHoldings();
    const holdingSymbols = holdings.map(h => h.symbol);
    let holdingCurrentPrices: Record<string, number> = {};
    
    if (holdingSymbols.length > 0) {
      console.log(`📊 보유 종목 현재가 수집: ${holdingSymbols.join(', ')}`);
      const holdingPricesData = await fetchDailyPrices(holdingSymbols);
      for (const [symbol, prices] of Object.entries(holdingPricesData)) {
        if (prices && prices.length > 0) {
          holdingCurrentPrices[symbol] = prices[prices.length - 1].close;
          console.log(`💰 ${symbol}: $${holdingCurrentPrices[symbol]}`);
        }
      }
    }

    // 7. 보고서 생성을 위한 데이터 준비
    const reportPayload = await prepareReportPayload({
      sectorCode,
      sectorTitle,
      symbols,
      pricesData,
      indicatorsData,
      newsData,
      screeningResults,
      currentPrices: holdingCurrentPrices // 보유 종목 현재가 전달
    });

    // 8. AI 보고서 생성
    console.log('🤖 AI 보고서 생성 중...');
    const report = await generateReport(reportPayload);

    // 9. 보고서 파일 저장
    console.log('💾 보고서 파일 저장 중...');
    const { mdPath, htmlPath } = await saveReportFiles(sectorCode, report);

    // 10. 이메일 발송
    console.log('📧 이메일 발송 중...');
    const emailHtml = wrapInEmailTemplate(
      report.replace(/\n/g, '<br>'), 
      `데일리 리포트 - ${sectorTitle} (${new Date().toLocaleDateString('ko-KR')})`
    );
    
    await sendReportEmail({
      subject: `📊 ${sectorTitle} 데일리 리포트 - ${new Date().toLocaleDateString('ko-KR')}`,
      html: emailHtml,
      mdPath: mdPath
    });

  } catch (error) {
    console.error(`❌ 섹터 ${sectorCode} 처리 중 오류:`, error);
    throw error;
  }
}

/**
 * 기술지표 계산 (모든 심볼)
 */
async function calculateIndicators(pricesData: Record<string, any[]>): Promise<Record<string, any>> {
  const indicators: Record<string, any> = {};

  for (const [symbol, prices] of Object.entries(pricesData)) {
    try {
      if (prices.length >= 50) {
        const closePrices = prices.map(p => p.close);
        const computed = computeIndicators(closePrices);
        
        indicators[symbol] = {
          close: closePrices[closePrices.length - 1],
          ...computed
        };
      } else {
        console.warn(`⚠️ ${symbol}: 기술지표 계산을 위한 데이터 부족 (${prices.length}일)`);
      }
    } catch (error) {
      console.error(`❌ ${symbol} 기술지표 계산 실패:`, error);
    }
  }

  return indicators;
}

/**
 * 보고서 생성을 위한 페이로드 준비
 */
async function prepareReportPayload(params: {
  sectorCode: string;
  sectorTitle: string;
  symbols: string[];
  pricesData: Record<string, any[]>;
  indicatorsData: Record<string, any>;
  newsData: any[];
  screeningResults?: any[];
  currentPrices?: Record<string, number>;
}): Promise<any> {
  const { sectorCode, sectorTitle, symbols, indicatorsData, newsData, screeningResults = [] } = params;

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

  // 스크리닝 결과에서 점수 추출 (동적 분석 결과 사용)
  const scores: Record<string, number> = {};
  for (const result of screeningResults) {
    scores[result.symbol] = result.overall_score;
  }

  // 스크리닝 결과가 없는 경우 기존 로직 사용
  for (const symbol of symbols) {
    if (!scores[symbol]) {
      const indicator = indicatorsData[symbol];
      if (indicator) {
        let score = 0;
        
        // EMA 기반 모멘텀
        if (indicator.ema20 > indicator.ema50) score += 0.3;
        else score -= 0.3;
        
        // RSI 기반 점수
        if (indicator.rsi14 < 35) score += 0.2; // 과매도
        else if (indicator.rsi14 > 70) score -= 0.2; // 과매수
        
        // 뉴스 감성 점수
        const symbolNews = newsData.filter(n => n.symbol === symbol);
        if (symbolNews.length > 0) {
          const avgSentiment = symbolNews.reduce((sum, n) => sum + n.sentiment, 0) / symbolNews.length;
          score += avgSentiment * 0.3;
        }
        
        scores[symbol] = Math.max(0, Math.min(1, (score + 1) / 2)); // 0-1 범위로 정규화
      }
    }
  }

  // 성과 추적 및 분석 (첫 번째 섹터에서만 실행)
  let performanceReport = '';
  if (sectorCode === 'ai') { // AI 섹터 처리시에만 성과 분석
    try {
      console.log('📊 포트폴리오 성과 분석 중...');
      
      // 현재가 데이터 추출
      const currentPrices: Record<string, number> = {};
      for (const [symbol, indicator] of Object.entries(indicatorsData)) {
        if (indicator && indicator.close) {
          currentPrices[symbol] = indicator.close;
        }
      }
      
      // 보유 종목의 현재가 데이터 별도 수집 (indicatorsData에 없을 경우 대비)
      const holdingSymbols = holdings.map(h => h.symbol);
      const missingHoldings = holdingSymbols.filter(symbol => !currentPrices[symbol]);
      
      if (missingHoldings.length > 0) {
        console.log(`📊 보유 종목 현재가 별도 수집: ${missingHoldings.join(', ')}`);
        const holdingPrices = await fetchDailyPrices(missingHoldings);
        for (const [symbol, prices] of Object.entries(holdingPrices)) {
          if (prices && prices.length > 0) {
            currentPrices[symbol] = prices[prices.length - 1].close;
            console.log(`💰 ${symbol}: $${currentPrices[symbol]}`);
          }
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
      
      console.log(`📈 성과 추적 완료: 현재 ₩${performance.current_value_krw.toLocaleString()} (${performance.total_return_percent > 0 ? '+' : ''}${performance.total_return_percent}%)`);
      
    } catch (error) {
      console.error('❌ 성과 분석 실패:', error);
      performanceReport = '\n## ⚠️ 성과 분석 오류\n데이터를 불러오는 중 문제가 발생했습니다.\n';
    }
  }

  return {
    lookback_days: parseInt(process.env.REPORT_LOOKBOOK_DAYS || '30'),
    portfolio,
    market: {
      date: new Date().toISOString().split('T')[0],
      sector_code: sectorCode,
      sector_title: sectorTitle,
      exchange_rate: exchangeRate
    },
    indicators: indicatorsData,
    news: newsData.slice(0, 10), // 상위 10개 뉴스
    scores,
    performanceReport, // 성과 리포트 추가
    currentPrices: params.currentPrices || {} // 현재가 데이터 명시적 추가
  };
}

/**
 * 보고서 파일 저장 (요약 포함)
 */
async function saveReportFilesWithSummary(sectorCode: string, report: string, summary: string): Promise<{mdPath: string, htmlPath: string}> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const reportDir = path.join(process.cwd(), 'data', 'report');
  
  // 디렉토리 생성
  await fs.mkdir(reportDir, { recursive: true });
  
  const mdPath = path.join(reportDir, `${today}_${sectorCode}.md`);
  const htmlPath = path.join(reportDir, `${today}_${sectorCode}.html`);
  const summaryPath = path.join(reportDir, `${today}_${sectorCode}_summary.txt`);
  
  // 마크다운 파일 저장
  await fs.writeFile(mdPath, report, 'utf8');
  
  // 요약 파일 저장
  await fs.writeFile(summaryPath, summary, 'utf8');
  
  // HTML 파일 저장 (간단한 변환)
  const html = wrapInEmailTemplate(
    report.replace(/\n/g, '<br>'),
    `통합 데일리 리포트 (${today})`
  );
  await fs.writeFile(htmlPath, html, 'utf8');
  
  // 메타데이터 파일 저장 (대시보드용)
  const metadata = {
    date: today,
    type: sectorCode,
    title: `통합 데일리 리포트 - ${new Date().toLocaleDateString('ko-KR')}`,
    summary: summary,
    mdPath: mdPath,
    htmlPath: htmlPath,
    createdAt: new Date().toISOString()
  };
  
  const metadataPath = path.join(reportDir, `${today}_${sectorCode}_meta.json`);
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  
  console.log(`✅ 리포트 저장 완료: ${mdPath}`);
  console.log(`✅ 요약 저장 완료: ${summaryPath}`);
  console.log(`✅ 메타데이터 저장 완료: ${metadataPath}`);
  
  return { mdPath, htmlPath };
}

/**
 * 보고서 파일 저장 (기존 함수 - 호환성 유지)
 */
async function saveReportFiles(sectorCode: string, report: string): Promise<{mdPath: string, htmlPath: string}> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const reportDir = path.join(process.cwd(), 'data', 'report');
  
  // 디렉토리 생성
  await fs.mkdir(reportDir, { recursive: true });
  
  const mdPath = path.join(reportDir, `${today}_${sectorCode}.md`);
  const htmlPath = path.join(reportDir, `${today}_${sectorCode}.html`);
  
  // 마크다운 파일 저장
  await fs.writeFile(mdPath, report, 'utf8');
  
  // HTML 파일 저장 (간단한 변환)
  const html = wrapInEmailTemplate(
    report.replace(/\n/g, '<br>'),
    `데일리 리포트 - ${sectorCode} (${today})`
  );
  await fs.writeFile(htmlPath, html, 'utf8');
  
  return { mdPath, htmlPath };
}

/**
 * 통합 리포트 처리 (모든 섹터 데이터를 하나의 리포트로 통합)
 */
async function processUnifiedReport(sectors: any, screeningResults: any): Promise<void> {
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
    console.log('📈 통합 가격 데이터 수집 중...');
    const pricesData = await fetchDailyPrices(symbolsArray);
    
    // 통합 기술지표 계산
    console.log('📊 통합 기술지표 계산 중...');
    const indicatorsData = await calculateIndicators(pricesData);
    
    // 통합 뉴스 수집
    console.log('📰 통합 뉴스 수집 중...');
    const newsData = await fetchNews({
      symbols: symbolsArray,
      sector: 'unified',
      limit: 30, // 통합 리포트이므로 더 많은 뉴스
      fromDate: getDateDaysAgo(7)
    });
    
    // 보유 종목 현재가 수집 (통합 리포트용)
    console.log('💰 통합 리포트용 보유 종목 현재가 수집 중...');
    const holdings = await getHoldings();
    const holdingSymbols = holdings.map(h => h.symbol);
    let holdingCurrentPrices: Record<string, number> = {};
    
    if (holdingSymbols.length > 0) {
      console.log(`📊 보유 종목 현재가 수집: ${holdingSymbols.join(', ')}`);
      const holdingPricesData = await fetchDailyPrices(holdingSymbols);
      for (const [symbol, prices] of Object.entries(holdingPricesData)) {
        if (prices && prices.length > 0) {
          holdingCurrentPrices[symbol] = prices[prices.length - 1].close;
          console.log(`💰 ${symbol}: $${holdingCurrentPrices[symbol]}`);
        }
      }
    }
    
    // 통합 리포트 페이로드 준비
    const reportPayload = await prepareUnifiedReportPayload({
      allSectors: sectors,
      symbols: symbolsArray,
      pricesData,
      indicatorsData,
      newsData,
      screeningResults: allScreeningResults,
      currentPrices: holdingCurrentPrices // 보유 종목 현재가 전달
    });
    
    // AI 통합 리포트 생성
    console.log('🤖 AI 통합 리포트 생성 중...');
    const report = await generateReport(reportPayload);
    
    // 통합 리포트 파일 저장
    console.log('💾 통합 리포트 파일 저장 중...');
    const { mdPath, htmlPath } = await saveReportFiles('unified', report);
    
    // 이메일 발송
    console.log('📧 통합 리포트 이메일 발송 중...');
    const emailHtml = wrapInEmailTemplate(
      report.replace(/\n/g, '<br>'), 
      `통합 데일리 리포트 (${new Date().toLocaleDateString('ko-KR')})`
    );
    
    // 이메일 전송 (선택사항)
    try {
      await sendReportEmail({
        subject: `📊 통합 데일리 리포트 - ${new Date().toLocaleDateString('ko-KR')}`,
        html: emailHtml,
        mdPath: mdPath
      });
      console.log('📧 이메일 전송 완료');
    } catch (emailError) {
      console.warn('⚠️ 이메일 전송 실패 (선택사항):', (emailError as Error).message);
      // 이메일 전송 실패는 전체 프로세스를 중단시키지 않음
    }
    
    console.log('✅ 통합 리포트 처리 완료');
    
  } catch (error) {
    console.error('❌ 통합 리포트 처리 실패:', error);
    throw error;
  }
}

/**
 * 통합 리포트용 페이로드 준비
 */
async function prepareUnifiedReportPayload(params: {
  allSectors: any;
  symbols: string[];
  pricesData: Record<string, any[]>;
  indicatorsData: Record<string, any>;
  newsData: any[];
  screeningResults: any[];
  currentPrices?: Record<string, number>;
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

  // 스크리닝 결과가 없는 경우 기존 로직 사용
  for (const symbol of symbols) {
    if (!scores[symbol]) {
      const indicator = indicatorsData[symbol];
      if (indicator) {
        let score = 0;
        
        // EMA 기반 모멘텀
        if (indicator.ema20 > indicator.ema50) score += 0.3;
        else score -= 0.3;
        
        // RSI 기반 점수
        if (indicator.rsi14 < 35) score += 0.2; // 과매도
        else if (indicator.rsi14 > 70) score -= 0.2; // 과매수
        
        // 뉴스 감성 점수
        const symbolNews = newsData.filter(n => n.symbol === symbol);
        if (symbolNews.length > 0) {
          const avgSentiment = symbolNews.reduce((sum, n) => sum + n.sentiment, 0) / symbolNews.length;
          score += avgSentiment * 0.3;
        }
        
        scores[symbol] = Math.max(0, Math.min(1, (score + 1) / 2)); // 0-1 범위로 정규화
      }
    }
  }

  // 성과 추적 및 분석
  let performanceReport = '';
  try {
    console.log('📊 포트폴리오 성과 분석 중...');
    
    // 보유 종목 심볼 추출
    const holdingSymbols = holdings.map(h => h.symbol);
    console.log(`💼 보유 종목: ${holdingSymbols.join(', ')}`);
    
    // 보유 종목의 현재가 데이터 조회
    const holdingPricesData = await fetchDailyPrices(holdingSymbols);
    
    // 현재가 데이터 추출 (분석 종목 + 보유 종목)
    const currentPrices: Record<string, number> = {};
    
    // 1. 분석 종목 현재가
    for (const [symbol, indicator] of Object.entries(indicatorsData)) {
      if (indicator && indicator.close) {
        currentPrices[symbol] = indicator.close;
      }
    }
    
    // 2. 보유 종목 현재가 (최우선)
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
    
    console.log(`📈 성과 추적 완료: 현재 ₩${performance.current_value_krw.toLocaleString()} (${performance.total_return_percent > 0 ? '+' : ''}${performance.total_return_percent}%)`);
    
  } catch (error) {
    console.error('❌ 성과 분석 실패:', error);
    performanceReport = '\n## ⚠️ 성과 분석 오류\n데이터를 불러오는 중 문제가 발생했습니다.\n';
  }

  return {
    lookback_days: parseInt(process.env.REPORT_LOOKBACK_DAYS || '30'),
    portfolio,
    market: {
      date: new Date().toISOString().split('T')[0],
      sector_code: 'unified',
      sector_title: '통합 시장 분석',
      exchange_rate: exchangeRate,
      sectors: allSectors,
      symbols_by_sector: symbolsBySector
    },
    indicators: indicatorsData,
    news: newsData.slice(0, 15), // 상위 15개 뉴스
    scores,
    performanceReport,
    total_symbols_count: symbols.length,
    screening_results: screeningResults,
    currentPrices: params.currentPrices || {} // 현재가 데이터 명시적 추가
  };
}

/**
 * N일 전 날짜 문자열 반환
 */
function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}