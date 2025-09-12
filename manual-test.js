require('dotenv').config();

const { loadSectors } = require('./dist/utils/config');
const { runFullScreening } = require('./dist/services/screening');
const { fetchDailyPrices } = require('./dist/services/market');
const { fetchNews } = require('./dist/services/news');
const { getHoldings, getCashBalance } = require('./dist/storage/database');
const { getCachedExchangeRate } = require('./dist/services/exchange');
const { computeIndicators } = require('./dist/services/market');
const { generateReport } = require('./dist/services/llm');
const { generateReportWithGemini } = require('./dist/services/gemini');
const { generateReportWithClaude } = require('./dist/services/claude');
const { sendReportEmail, wrapInEmailTemplate } = require('./dist/services/mail');
const fs = require('fs/promises');
const path = require('path');

/**
 * 3개 AI (GPT-5, Gemini 2.5 Flash, Claude Opus 4.1) 리포트 수동 테스트
 * 매일 자동 실행되는 시스템의 수동 테스트용 스크립트
 */
async function testTripleAIReports() {
  console.log('🔍 3개 AI 리포트 수동 테스트 시작...');
  
  try {
    // 1. 섹터 설정 로드
    console.log('📋 섹터 설정 로드 중...');
    const sectors = await loadSectors();
    console.log(`✅ ${Object.keys(sectors).length}개 섹터 로드됨`);

    // 2. 종목 스크리닝
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
    const news = await fetchNews({
      symbols: symbolsArray,
      sector: 'unified',
      limit: 10,
      fromDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    });
    console.log(`✅ ${news.length}개 뉴스 수집됨`);
    
    // 7. 포트폴리오 데이터 준비
    console.log('💼 포트폴리오 데이터 준비 중...');
    const [holdings, cashBalance, exchangeRate] = await Promise.all([
      getHoldings(),
      getCashBalance(),
      getCachedExchangeRate()
    ]);
    
    // 공통 데이터 구조
    const stocks = allScreeningResults.map(r => ({
      symbol: r.symbol,
      name: r.name || r.symbol,
      sector: r.sector_code || r.sector
    }));
    
    // 8. GPT-5 리포트 생성
    console.log('🤖 GPT-5 리포트 생성 중...');
    const reportPayload = {
      lookback_days: 30,
      portfolio: {
        cash_usd: cashBalance,
        holdings: holdings
      },
      market: {
        date: new Date().toISOString().split('T')[0],
        sector_code: 'unified',
        sector_title: '통합 시장 분석',
        exchange_rate: exchangeRate
      },
      indicators: indicators,
      news: news.slice(0, 10),
      scores: Object.fromEntries(
        stocks.map(stock => [stock.symbol, Math.random() * 0.5 + 0.5])
      ),
      currentPrices: Object.fromEntries(
        Object.entries(indicators).map(([symbol, ind]) => [symbol, ind.close || 0])
      )
    };
    
    const gptReport = await generateReport(reportPayload);
    console.log('✅ GPT-5 리포트 생성 완료');
    
    // 9. Gemini 리포트 생성
    let geminiReport = '';
    if (process.env.ENABLE_GEMINI_REPORT === 'true') {
      console.log('🤖 Gemini 리포트 생성 중...');
      try {
        geminiReport = await generateReportWithGemini(stocks, indicators, indicators, news, holdings);
        console.log('✅ Gemini 리포트 생성 완료');
      } catch (error) {
        console.error('❌ Gemini 리포트 생성 실패:', error);
        geminiReport = '## ⚠️ Gemini 리포트\n\nGemini API 연결 문제로 리포트를 생성할 수 없습니다.';
      }
    }
    
    // 10. Claude 리포트 생성
    let claudeReport = '';
    if (process.env.CLAUDE_API_KEY) {
      console.log('🤖 Claude 리포트 생성 중...');
      try {
        claudeReport = await generateReportWithClaude(stocks, indicators, indicators, news, holdings);
        console.log('✅ Claude 리포트 생성 완료');
      } catch (error) {
        console.error('❌ Claude 리포트 생성 실패:', error);
        claudeReport = '## ⚠️ Claude 리포트\n\nClaude API 연결 문제로 리포트를 생성할 수 없습니다.';
      }
    }
    
    // 11. 리포트 파일 저장
    console.log('💾 리포트 파일 저장 중...');
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const reportDir = path.join(process.cwd(), 'data', 'report');
    
    // 디렉토리 생성
    await fs.mkdir(reportDir, { recursive: true });
    
    // GPT-5 리포트 저장
    const gptMdPath = path.join(reportDir, `${today}_test_gpt5.md`);
    await fs.writeFile(gptMdPath, gptReport, 'utf8');
    console.log(`✅ GPT-5 리포트 저장: ${gptMdPath}`);
    
    // Gemini 리포트 저장
    let geminiMdPath = '';
    if (geminiReport) {
      geminiMdPath = path.join(reportDir, `${today}_test_gemini.md`);
      await fs.writeFile(geminiMdPath, geminiReport, 'utf8');
      console.log(`✅ Gemini 리포트 저장: ${geminiMdPath}`);
    }
    
    // Claude 리포트 저장
    let claudeMdPath = '';
    if (claudeReport) {
      claudeMdPath = path.join(reportDir, `${today}_test_claude.md`);
      await fs.writeFile(claudeMdPath, claudeReport, 'utf8');
      console.log(`✅ Claude 리포트 저장: ${claudeMdPath}`);
    }
    
    // 12. 이메일 발송
    console.log('📧 이메일 발송 시작...');
    
    // GPT-5 이메일 발송
    try {
      const gptEmailHtml = wrapInEmailTemplate(
        gptReport.replace(/\n/g, '<br>'), 
        `GPT-5 테스트 리포트 (${new Date().toLocaleDateString('ko-KR')})`
      );
      
      await sendReportEmail({
        subject: `🤖 GPT-5 테스트 리포트 - ${new Date().toLocaleDateString('ko-KR')}`,
        html: gptEmailHtml,
        mdPath: gptMdPath
      });
      console.log('📧 GPT-5 이메일 전송 완료');
    } catch (emailError) {
      console.warn('⚠️ GPT-5 이메일 전송 실패:', emailError.message);
    }
    
    // Gemini 이메일 발송
    if (geminiReport && geminiMdPath) {
      try {
        const geminiEmailHtml = wrapInEmailTemplate(
          geminiReport.replace(/\n/g, '<br>'), 
          `Gemini 테스트 리포트 (${new Date().toLocaleDateString('ko-KR')})`
        );
        
        await sendReportEmail({
          subject: `🤖 Gemini 테스트 리포트 - ${new Date().toLocaleDateString('ko-KR')}`,
          html: geminiEmailHtml,
          mdPath: geminiMdPath
        });
        console.log('📧 Gemini 이메일 전송 완료');
      } catch (emailError) {
        console.warn('⚠️ Gemini 이메일 전송 실패:', emailError.message);
      }
    }
    
    // Claude 이메일 발송
    if (claudeReport && claudeMdPath) {
      try {
        const claudeEmailHtml = wrapInEmailTemplate(
          claudeReport.replace(/\n/g, '<br>'), 
          `Claude 테스트 리포트 (${new Date().toLocaleDateString('ko-KR')})`
        );
        
        await sendReportEmail({
          subject: `🤖 Claude 테스트 리포트 - ${new Date().toLocaleDateString('ko-KR')}`,
          html: claudeEmailHtml,
          mdPath: claudeMdPath
        });
        console.log('📧 Claude 이메일 전송 완료');
      } catch (emailError) {
        console.warn('⚠️ Claude 이메일 전송 실패:', emailError.message);
      }
    }
    
    console.log('\n🎉 3개 AI 리포트 테스트 완료!');
    console.log('\n📊 생성된 리포트 요약:');
    console.log(`- 분석 종목 수: ${symbolsArray.length}개`);
    console.log(`- 기술지표 계산 종목: ${Object.keys(indicators).length}개`);
    console.log(`- 수집된 뉴스: ${news.length}개`);
    console.log(`- 보유 종목: ${holdings.length}개`);
    console.log(`- GPT-5 리포트: ${gptReport ? '생성됨' : '실패'}`);
    console.log(`- Gemini 리포트: ${geminiReport ? '생성됨' : '비활성화/실패'}`);
    console.log(`- Claude 리포트: ${claudeReport ? '생성됨' : '비활성화/실패'}`);
    
  } catch (error) {
    console.error('❌ 3개 AI 리포트 테스트 실패:', error);
    throw error;
  }
}

// 실행
testTripleAIReports().catch(console.error);