// 환경 변수 로드
require('dotenv').config();

const { generateReport } = require('./dist/services/llm');
const { generateReportWithGemini } = require('./dist/services/gemini');

/**
 * GPT-5와 Gemini Pro 이중 보고서 생성 테스트
 */
async function testDualReports() {
  console.log('🔍 이중 AI 보고서 생성 테스트 시작...');
  
  try {
    // 샘플 데이터 준비
    const sampleStocks = [
      { symbol: 'GOOGL', name: 'Alphabet Inc', sector: 'ai' },
      { symbol: 'NVDA', name: 'NVIDIA Corporation', sector: 'ai' },
      { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'computing' }
    ];
    
    const samplePriceData = {
      'GOOGL': [{ close: 195.32 }],
      'NVDA': [{ close: 138.07 }],
      'MSFT': [{ close: 441.58 }]
    };
    
    const sampleIndicators = {
      'GOOGL': { ema20: 195, ema50: 185, rsi14: 65.4 },
      'NVDA': { ema20: 138, ema50: 135, rsi14: 58.2 },
      'MSFT': { ema20: 442, ema50: 435, rsi14: 62.1 }
    };
    
    const sampleNews = [
      { headline: 'AI 반도체 수요 증가', published_at: new Date().toISOString() },
      { headline: '클라우드 시장 성장 지속', published_at: new Date().toISOString() }
    ];
    
    const sampleHoldings = [];
    
    // 1. GPT-5 보고서 생성 테스트
    console.log('\n🤖 GPT-5 보고서 생성 테스트...');
    
    const gptPayload = {
      lookback_days: 30,
      portfolio: { cash_usd: 10000, holdings: sampleHoldings },
      market: {
        date: new Date().toISOString().split('T')[0],
        sector_code: 'unified',
        sector_title: '통합 시장 분석'
      },
      indicators: sampleIndicators,
      news: sampleNews,
      scores: { 'GOOGL': 0.8, 'NVDA': 0.75, 'MSFT': 0.7 }
    };
    
    const gptReport = await generateReport(gptPayload);
    console.log('✅ GPT-5 보고서 생성 성공');
    console.log('📄 GPT-5 보고서 길이:', gptReport.length, '문자');
    
    // 2. Gemini Pro 보고서 생성 테스트
    console.log('\n🤖 Gemini Pro 보고서 생성 테스트...');
    
    let geminiReport = '';
    if (process.env.ENABLE_GEMINI_REPORT === 'true') {
      try {
        geminiReport = await generateReportWithGemini(
          sampleStocks, 
          samplePriceData, 
          sampleIndicators, 
          sampleNews, 
          sampleHoldings
        );
        console.log('✅ Gemini Pro 보고서 생성 성공');
        console.log('📄 Gemini Pro 보고서 길이:', geminiReport.length, '문자');
        
        // 두 보고서가 다른지 확인
        const isDifferent = gptReport.substring(0, 100) !== geminiReport.substring(0, 100);
        console.log('🔍 두 보고서가 서로 다름:', isDifferent ? '✅ 예' : '❌ 아니오');
        
      } catch (error) {
        console.error('❌ Gemini Pro 보고서 생성 실패:', error.message);
        geminiReport = '## ⚠️ Gemini Pro 리포트\n\nGemini API 연결 문제로 리포트를 생성할 수 없습니다.';
      }
    } else {
      console.log('⚠️ Gemini Pro 보고서가 비활성화되어 있습니다 (ENABLE_GEMINI_REPORT=false)');
    }
    
    // 3. 보고서 저장 테스트
    const fs = require('fs/promises');
    const path = require('path');
    
    const reportDir = path.join(process.cwd(), 'data', 'report');
    await fs.mkdir(reportDir, { recursive: true });
    
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const gptPath = path.join(reportDir, `${today}_test_gpt5.md`);
    const geminiPath = path.join(reportDir, `${today}_test_gemini.md`);
    
    await fs.writeFile(gptPath, gptReport, 'utf8');
    console.log('💾 GPT-5 테스트 보고서 저장:', gptPath);
    
    if (geminiReport) {
      await fs.writeFile(geminiPath, geminiReport, 'utf8');
      console.log('💾 Gemini Pro 테스트 보고서 저장:', geminiPath);
    }
    
    // 4. 결과 요약
    console.log('\n📊 테스트 결과 요약:');
    console.log('- GPT-5 보고서: ✅ 생성 성공');
    console.log('- Gemini Pro 보고서:', geminiReport ? '✅ 생성 성공' : '❌ 생성 실패');
    console.log('- 환경변수 ENABLE_GEMINI_REPORT:', process.env.ENABLE_GEMINI_REPORT);
    
    console.log('\n🎉 이중 AI 보고서 테스트 완료!');
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
  }
}

// 스크립트 실행
if (require.main === module) {
  testDualReports();
}