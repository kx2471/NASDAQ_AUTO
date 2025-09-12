// 환경 변수 로드
require('dotenv').config();

const { testGeminiConnection, generateReportWithGemini } = require('./dist/services/gemini.js');

/**
 * Gemini Pro API 연결 및 보고서 생성 테스트
 */
async function testGeminiReport() {
  console.log('🔍 Gemini Pro 테스트 시작...');
  
  try {
    // 1. API 연결 테스트
    console.log('📡 Gemini API 연결 테스트 중...');
    const isConnected = await testGeminiConnection();
    
    if (!isConnected) {
      console.error('❌ Gemini API 연결 실패');
      return;
    }
    
    console.log('✅ Gemini API 연결 성공');
    
    // 2. 샘플 데이터로 보고서 생성 테스트
    console.log('📊 샘플 보고서 생성 테스트 중...');
    
    const sampleStocks = [
      { symbol: 'GOOGL', name: 'Alphabet Inc', sector: 'ai' },
      { symbol: 'NVDA', name: 'NVIDIA Corp', sector: 'ai' },
      { symbol: 'MSFT', name: 'Microsoft Corp', sector: 'computing' },
      { symbol: 'TSLA', name: 'Tesla Inc', sector: 'nuclear' },
      { symbol: 'AAPL', name: 'Apple Inc', sector: 'ai' }
    ];
    
    const samplePriceData = {
      'GOOGL': [{ close: 232.50, date: '2025-09-12' }],
      'NVDA': [{ close: 175.30, date: '2025-09-12' }],
      'MSFT': [{ close: 425.80, date: '2025-09-12' }],
      'TSLA': [{ close: 368.81, date: '2025-09-12' }],
      'AAPL': [{ close: 225.75, date: '2025-09-12' }]
    };
    
    const sampleIndicators = {
      'GOOGL': { ema20: 230.5, ema50: 225.3, rsi14: 84.3 },
      'NVDA': { ema20: 174.8, ema50: 170.2, rsi14: 54.6 },
      'MSFT': { ema20: 422.1, ema50: 418.7, rsi14: 62.1 },
      'TSLA': { ema20: 341.5, ema50: 331.3, rsi14: 67.2 },
      'AAPL': { ema20: 224.2, ema50: 222.8, rsi14: 58.9 }
    };
    
    const sampleNews = [
      { headline: 'AI 기업들 3분기 실적 기대감 확산' },
      { headline: 'NVIDIA, 새로운 AI 칩 발표 예고' },
      { headline: '테슬라, 자율주행 기술 업데이트 공개' },
      { headline: '구글 클라우드, AI 서비스 확장 발표' },
      { headline: '애플, AI 기능 탑재한 신제품 출시' }
    ];
    
    const sampleHoldings = [
      { symbol: 'TSLA', shares: 4.61, averagePrice: 318.02 },
      { symbol: 'PL', shares: 31, averagePrice: 6.94 }
    ];
    
    const report = await generateReportWithGemini(
      sampleStocks,
      samplePriceData,
      sampleIndicators,
      sampleNews,
      sampleHoldings
    );
    
    console.log('✅ Gemini 보고서 생성 성공!');
    console.log('\n📋 생성된 보고서 미리보기:');
    console.log('='.repeat(50));
    console.log(report.substring(0, 500) + '...');
    console.log('='.repeat(50));
    
    // 보고서 파일로 저장
    const fs = require('fs').promises;
    const path = require('path');
    
    const reportDir = path.join(__dirname, 'data', 'report');
    await fs.mkdir(reportDir, { recursive: true });
    
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const reportPath = path.join(reportDir, `${today}_gemini_test.md`);
    
    await fs.writeFile(reportPath, report, 'utf8');
    console.log(`💾 보고서 저장 완료: ${reportPath}`);
    
    console.log('\n🎉 Gemini Pro 테스트 완료!');
    
  } catch (error) {
    console.error('❌ Gemini 테스트 실패:', error.message);
    console.error('상세 오류:', error);
  }
}

// 스크립트 실행
if (require.main === module) {
  testGeminiReport();
}