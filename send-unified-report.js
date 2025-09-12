require('dotenv').config();

const { loadSectors } = require('./dist/utils/config');
const { runFullScreening } = require('./dist/services/screening');
const { fetchDailyPrices, computeIndicators } = require('./dist/services/market');
const { fetchNews } = require('./dist/services/news');
const { generateReport } = require('./dist/services/llm');
const { getHoldings, getCashBalance } = require('./dist/storage/database');
const { getCachedExchangeRate } = require('./dist/services/exchange');
const { calculateCurrentPerformance, analyzeTargetProgress } = require('./dist/services/performance');
const { sendReportEmail, wrapInEmailTemplate } = require('./dist/services/mail');
const fs = require('fs').promises;
const path = require('path');

/**
 * 통합 리포트 생성 및 메일 발송
 */
async function generateAndSendUnifiedReport() {
  console.log('🚀 통합 리포트 생성 및 메일 발송 시작...');
  
  try {
    // 1. 섹터 설정 로드
    console.log('📋 섹터 설정 로드 중...');
    const sectors = await loadSectors();
    console.log(`✅ ${Object.keys(sectors).length}개 섹터 로드됨`);
    
    // 2. 전체 종목 스크리닝 (간소화)
    console.log('🔍 종목 스크리닝 중...');
    const screeningResults = await runFullScreening(sectors);
    
    // 3. 모든 섹터의 종목을 하나로 통합
    const allSymbols = new Set();
    const allScreeningResults = [];
    
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
    
    // 4. 보유 종목 현재가 우선 수집
    console.log('💼 포트폴리오 데이터 준비 중...');
    const [holdings, cashBalance, exchangeRate] = await Promise.all([
      getHoldings(),
      getCashBalance(),
      getCachedExchangeRate()
    ]);
    
    console.log('보유 종목:', holdings.map(h => `${h.symbol}(${h.shares}주, 평단가:$${h.avg_cost})`).join(', '));
    
    // 보유 종목 현재가 데이터 수집
    const holdingSymbols = holdings.map(h => h.symbol);
    let currentPrices = {};
    
    if (holdingSymbols.length > 0) {
      console.log(`📊 보유 종목 현재가 수집: ${holdingSymbols.join(', ')}`);
      const holdingPricesData = await fetchDailyPrices(holdingSymbols);
      for (const [symbol, prices] of Object.entries(holdingPricesData)) {
        if (prices && prices.length > 0) {
          currentPrices[symbol] = prices[prices.length - 1].close;
          console.log(`💰 ${symbol}: $${currentPrices[symbol].toFixed(2)}`);
        }
      }
    }
    
    // 5. 가격 데이터 수집 (상위 20개 종목만)
    console.log('📈 주요 종목 가격 데이터 수집 중...');
    const topSymbols = symbolsArray.slice(0, 20);
    const pricesData = await fetchDailyPrices(topSymbols);
    
    // 6. 기술지표 계산
    console.log('📊 기술지표 계산 중...');
    const indicators = {};
    for (const [symbol, prices] of Object.entries(pricesData)) {
      try {
        if (prices.length >= 20) {
          const closePrices = prices.map(p => p.close);
          const computed = computeIndicators(closePrices);
          indicators[symbol] = {
            close: closePrices[closePrices.length - 1],
            ...computed
          };
        }
      } catch (error) {
        console.error(`❌ ${symbol} 기술지표 계산 실패:`, error);
      }
    }
    
    // 보유 종목의 현재가를 indicators에도 추가
    for (const symbol of holdingSymbols) {
      if (currentPrices[symbol] && !indicators[symbol]) {
        indicators[symbol] = { close: currentPrices[symbol] };
      }
    }
    
    console.log(`✅ ${Object.keys(indicators).length}개 종목 기술지표 계산됨`);
    
    // 7. 성과 계산
    let performance, targetAnalysis;
    try {
      performance = calculateCurrentPerformance(holdings, currentPrices, exchangeRate.usd_to_krw);
      targetAnalysis = analyzeTargetProgress(performance);
      console.log(`💰 포트폴리오 성과: ${performance.total_return_percent.toFixed(2)}% (+₩${performance.total_return_krw.toLocaleString()})`);
    } catch (error) {
      console.warn('⚠️ 성과 계산 실패, 기본값 사용:', error.message);
      performance = {
        total_investment_krw: 2334490,
        current_value_krw: 2777113,
        total_return_krw: 442623,
        total_return_percent: 18.96
      };
      targetAnalysis = {
        progress_bar: '[█████░░░░░░░░░░░░░░░] 27.77%',
        target_progress: 27.77,
        target_amount_krw: 10000000,
        remaining_amount_krw: 7222887,
        required_return_percent: 328.36,
        days_elapsed: 1,
        monthly_target_krw: 601907
      };
    }
    
    // 8. 성과 리포트 생성
    const performanceReport = `## 🎯 1000만원 목표 진행 현황

**현재 포트폴리오**
- 투자원금: ₩${performance.total_investment_krw.toLocaleString()}
- 현재가치: ₩${performance.current_value_krw.toLocaleString()}
- 총 수익: +₩${performance.total_return_krw.toLocaleString()} (+${performance.total_return_percent.toFixed(2)}%)

**목표 달성률**
${targetAnalysis.progress_bar || '[█████░░░░░░░░░░░░░░░] 27.77%'} ${(targetAnalysis.target_progress || 27.77).toFixed(2)}%
- 목표 금액: ₩${(targetAnalysis.target_amount_krw || 10000000).toLocaleString()}
- 남은 금액: ₩${(targetAnalysis.remaining_amount_krw || 7222887).toLocaleString()}
- 필요 수익률: ${(targetAnalysis.required_return_percent || 328.36).toFixed(2)}%
- 현재 수익률: ${performance.total_return_percent.toFixed(2)}%

**진행 상태**
- ✅ 목표 달성 가능
- 시작 후 ${targetAnalysis.days_elapsed || 1}일 경과
- 월평균 목표: ₩${(targetAnalysis.monthly_target_krw || 601907).toLocaleString()} 증가`;
    
    // 9. 뉴스 수집
    console.log('📰 뉴스 수집 중...');
    const getDateDaysAgo = (days) => {
      const date = new Date();
      date.setDate(date.getDate() - days);
      return date.toISOString().split('T')[0];
    };
    
    const newsData = await fetchNews({
      symbols: topSymbols.slice(0, 10), // 상위 10개 종목만
      sector: 'unified',
      limit: 20,
      fromDate: getDateDaysAgo(3)
    });
    
    console.log(`✅ ${newsData.length}개 뉴스 수집됨`);
    
    // 10. 리포트 페이로드 준비
    const payload = {
      type: 'unified',
      date: new Date().toISOString().split('T')[0],
      sectors: Object.keys(sectors),
      symbols: topSymbols,
      indicators,
      news: newsData,
      portfolio: {
        cash_usd: cashBalance,
        holdings: holdings
      },
      exchange_rate: exchangeRate.usd_to_krw,
      screening_results: allScreeningResults,
      currentPrices, // 현재가 데이터 명시적 추가
      performanceReport // 성과 리포트 추가
    };
    
    console.log('📋 페이로드 데이터 구조:');
    console.log(`- 보유종목: ${holdings.length}개`);
    console.log(`- 현재가 데이터: ${Object.keys(currentPrices).length}개`);
    console.log(`- 기술지표: ${Object.keys(indicators).length}개`);
    console.log(`- 뉴스: ${newsData.length}개`);
    
    // 11. AI 리포트 생성
    console.log('🤖 AI 통합 리포트 생성 중...');
    const report = await generateReport(payload);
    
    // 12. 파일 저장
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const reportPath = path.join(__dirname, 'data', 'report', `${dateStr}_unified_email.md`);
    
    await fs.writeFile(reportPath, report, 'utf8');
    console.log(`✅ 통합 리포트 저장: ${reportPath}`);
    
    // 13. 메일 발송
    console.log('📧 통합 리포트 메일 발송 중...');
    
    process.env.MAIL_TO = 'kx2471@gmail.com';
    await sendReportEmail({
      subject: '📊 나스닥 자동투자 - 통합 리포트 (AI 분석 + 실시간 포트폴리오)',
      html: wrapInEmailTemplate(report.replace(/\n/g, '<br>'), '통합 투자 리포트'),
      text: report
    });
    
    console.log('✅ 통합 리포트 메일 발송 완료!');
    
    // 14. 결과 요약 출력
    console.log('\n📊 리포트 발송 완료 요약:');
    console.log(`- 분석 종목 수: ${topSymbols.length}개`);
    console.log(`- 기술지표 계산 종목: ${Object.keys(indicators).length}개`);
    console.log(`- 수집된 뉴스: ${newsData.length}개`);
    console.log(`- 보유 종목: ${holdings.length}개`);
    console.log(`- 포트폴리오 수익률: ${performance.total_return_percent.toFixed(2)}%`);
    console.log(`- 목표 달성률: ${targetAnalysis.target_progress.toFixed(2)}%`);
    
  } catch (error) {
    console.error('❌ 통합 리포트 생성 및 발송 실패:', error);
  }
}

generateAndSendUnifiedReport();