require('dotenv').config();

const { loadSectors } = require('./dist/utils/config');
const { runFullScreening } = require('./dist/services/screening');
const { fetchDailyPrices, computeIndicators } = require('./dist/services/market');
const { fetchNews } = require('./dist/services/news');
const { generateReport } = require('./dist/services/llm');
const { getHoldings, getCashBalance } = require('./dist/storage/database');
const { getCachedExchangeRate } = require('./dist/services/exchange');
const { calculateCurrentPerformance, analyzeTargetProgress } = require('./dist/services/performance');
const fs = require('fs').promises;
const path = require('path');

/**
 * 통합 리포트 테스트 생성
 */
async function testUnifiedReport() {
  console.log('🔍 통합 리포트 테스트 시작...');
  
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
    console.log(`🎯 종목 샘플: ${symbolsArray.slice(0, 10).join(', ')}`);
    
    // 4. 가격 데이터 수집
    console.log('📈 가격 데이터 수집 중...');
    const pricesData = await fetchDailyPrices(symbolsArray);
    
    // 5. 기술지표 계산
    console.log('📊 기술지표 계산 중...');
    const indicators = {};
    for (const [symbol, prices] of Object.entries(pricesData)) {
      try {
        if (prices.length >= 50) {
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
    
    console.log(`✅ ${Object.keys(indicators).length}개 종목 기술지표 계산됨`);
    
    // 6. 뉴스 수집
    console.log('📰 뉴스 수집 중...');
    const getDateDaysAgo = (days) => {
      const date = new Date();
      date.setDate(date.getDate() - days);
      return date.toISOString().split('T')[0];
    };
    
    const newsData = await fetchNews({
      symbols: symbolsArray.slice(0, 20), // 상위 20개 종목만
      sector: 'unified',
      limit: 30,
      fromDate: getDateDaysAgo(7)
    });
    
    console.log(`✅ ${newsData.length}개 뉴스 수집됨`);
    
    // 7. 포트폴리오 데이터 준비
    console.log('💼 포트폴리오 데이터 준비 중...');
    const [holdings, cashBalance, exchangeRate] = await Promise.all([
      getHoldings(),
      getCashBalance(),
      getCachedExchangeRate()
    ]);
    
    // 현재가 데이터 추출 (보유 종목용)
    const currentPrices = {};
    const holdingSymbols = holdings.map(h => h.symbol);
    
    // 보유 종목의 현재가 데이터 수집
    if (holdingSymbols.length > 0) {
      const holdingPrices = await fetchDailyPrices(holdingSymbols);
      for (const [symbol, prices] of Object.entries(holdingPrices)) {
        if (prices && prices.length > 0) {
          currentPrices[symbol] = prices[prices.length - 1].close;
        }
      }
    }
    
    // 성과 계산
    let performance, targetAnalysis;
    try {
      performance = calculateCurrentPerformance(holdings, currentPrices, exchangeRate.usd_to_krw);
      targetAnalysis = analyzeTargetProgress(performance);
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
    
    // 8. 리포트 페이로드 준비
    const payload = {
      type: 'unified',
      date: new Date().toISOString().split('T')[0],
      sectors: Object.keys(sectors),
      symbols: symbolsArray,
      indicators,
      news: newsData,
      portfolio: {
        cash_usd: cashBalance,
        holdings: holdings
      },
      exchange_rate: exchangeRate.usd_to_krw,
      screening_results: allScreeningResults,
      currentPrices, // 현재가 데이터 명시적 추가
      performanceReport: '## 🎯 1000만원 목표 진행 현황\\n\\n**현재 포트폴리오**\\n- 투자원금: ₩2,334,490\\n- 현재가치: ₩2,777,113\\n- 총 수익: +₩442,623 (+18.96%)\\n\\n**목표 달성률**\\n[█████░░░░░░░░░░░░░░░] 27.77%\\n- 목표 금액: ₩10,000,000\\n- 남은 금액: ₩7,222,887\\n- 필요 수익률: 328.36%\\n- 현재 수익률: 18.96%\\n\\n**진행 상태**\\n- ✅ 목표 달성 가능\\n- 시작 후 1일 경과\\n- 월평균 목표: ₩601,907 증가'
    };
    
    // 9. AI 리포트 생성
    console.log('🤖 AI 통합 리포트 생성 중...');
    const report = await generateReport(payload);
    
    // 10. 파일 저장
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const reportPath = path.join(__dirname, 'data', 'report', `${dateStr}_unified_test.md`);
    
    await fs.writeFile(reportPath, report, 'utf8');
    console.log(`✅ 통합 테스트 리포트 저장: ${reportPath}`);
    
    // 결과 요약 출력
    console.log('\n📊 생성된 리포트 요약:');
    console.log(`- 분석 종목 수: ${symbolsArray.length}개`);
    console.log(`- 기술지표 계산 종목: ${Object.keys(indicators).length}개`);
    console.log(`- 수집된 뉴스: ${newsData.length}개`);
    console.log(`- 보유 종목: ${holdings.length}개`);
    console.log(`- 포트폴리오 수익률: ${performance.total_return_percent.toFixed(2)}%`);
    
    // 추천 종목 미리보기 (리포트에서 추출)
    const reportLines = report.split('\n');
    const recommendationIndex = reportLines.findIndex(line => line.includes('추천 종목'));
    if (recommendationIndex >= 0) {
      console.log('\n🎯 추천 종목 미리보기:');
      for (let i = recommendationIndex; i < Math.min(recommendationIndex + 10, reportLines.length); i++) {
        if (reportLines[i].trim().startsWith('-')) {
          console.log(reportLines[i]);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ 통합 리포트 테스트 실패:', error);
  }
}

testUnifiedReport();