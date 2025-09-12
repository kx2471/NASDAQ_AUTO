// 환경 변수 로드
require('dotenv').config();

const { generateReportWithGemini } = require('./dist/services/gemini');
const { sendReportEmail, wrapInEmailTemplate } = require('./dist/services/mail');
const { getHoldings } = require('./dist/storage/database');
const fs = require('fs/promises');
const path = require('path');

/**
 * Gemini Pro 보고서 즉시 생성 및 이메일 발송
 */
async function sendGeminiReport() {
  console.log('🚀 Gemini Pro 보고서 즉시 발송 시작...');
  
  try {
    // 샘플 데이터 준비 (실제 시장 데이터 기반)
    const stocks = [
      { symbol: 'GOOGL', name: 'Alphabet Inc', sector: 'AI/클라우드' },
      { symbol: 'NVDA', name: 'NVIDIA Corporation', sector: 'AI 반도체' },
      { symbol: 'MSFT', name: 'Microsoft Corporation', sector: '클라우드' },
      { symbol: 'AAPL', name: 'Apple Inc', sector: '테크' },
      { symbol: 'META', name: 'Meta Platforms', sector: 'AI/메타버스' }
    ];
    
    const priceData = {
      'GOOGL': [{ close: 195.32, date: '2025-09-12' }],
      'NVDA': [{ close: 138.07, date: '2025-09-12' }],
      'MSFT': [{ close: 441.58, date: '2025-09-12' }],
      'AAPL': [{ close: 225.77, date: '2025-09-12' }],
      'META': [{ close: 558.52, date: '2025-09-12' }]
    };
    
    const indicators = {
      'GOOGL': { ema20: 195.32, ema50: 185.20, rsi14: 65.4, close: 195.32 },
      'NVDA': { ema20: 138.07, ema50: 135.80, rsi14: 58.2, close: 138.07 },
      'MSFT': { ema20: 441.58, ema50: 435.90, rsi14: 62.1, close: 441.58 },
      'AAPL': { ema20: 225.77, ema50: 220.30, rsi14: 55.8, close: 225.77 },
      'META': { ema20: 558.52, ema50: 545.20, rsi14: 68.9, close: 558.52 }
    };
    
    const news = [
      { 
        headline: 'AI 반도체 수요 급증으로 NVIDIA 실적 전망 상향', 
        published_at: new Date().toISOString(),
        sentiment: 0.8
      },
      { 
        headline: 'Google Cloud AI 서비스 매출 30% 증가', 
        published_at: new Date().toISOString(),
        sentiment: 0.7
      },
      { 
        headline: 'Microsoft Copilot 사용자 1억명 돌파', 
        published_at: new Date().toISOString(),
        sentiment: 0.6
      },
      { 
        headline: 'Meta AI 모델 Llama 3 기업 도입 확산', 
        published_at: new Date().toISOString(),
        sentiment: 0.5
      },
      { 
        headline: '애플 iPhone AI 기능 사용률 증가세', 
        published_at: new Date().toISOString(),
        sentiment: 0.4
      }
    ];
    
    // 현재 보유 종목 조회
    let holdings = [];
    try {
      holdings = await getHoldings();
      console.log(`💼 현재 보유 종목: ${holdings.length}개`);
    } catch (error) {
      console.log('💼 보유 종목 정보를 불러올 수 없어 샘플 데이터 사용');
      holdings = [];
    }
    
    // Gemini Pro 보고서 생성
    console.log('🤖 Gemini Pro 보고서 생성 중...');
    const geminiReport = await generateReportWithGemini(stocks, priceData, indicators, news, holdings);
    
    console.log('✅ Gemini Pro 보고서 생성 완료');
    console.log(`📄 보고서 길이: ${geminiReport.length} 문자`);
    
    // 보고서 파일 저장
    const reportDir = path.join(process.cwd(), 'data', 'report');
    await fs.mkdir(reportDir, { recursive: true });
    
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const time = new Date().toTimeString().substr(0, 5).replace(':', '');
    const mdPath = path.join(reportDir, `${today}_${time}_gemini_manual.md`);
    
    await fs.writeFile(mdPath, geminiReport, 'utf8');
    console.log('💾 보고서 파일 저장:', mdPath);
    
    // 이메일 발송
    console.log('📧 Gemini Pro 보고서 이메일 발송 중...');
    
    const emailHtml = wrapInEmailTemplate(
      geminiReport.replace(/\n/g, '<br>'), 
      `Gemini Pro 테스트 리포트 (${new Date().toLocaleDateString('ko-KR')} ${new Date().toLocaleTimeString('ko-KR')})`
    );
    
    await sendReportEmail({
      subject: `🤖 Gemini Pro 테스트 리포트 - ${new Date().toLocaleDateString('ko-KR')} ${new Date().toLocaleTimeString('ko-KR')}`,
      html: emailHtml,
      mdPath: mdPath
    });
    
    console.log('✅ 이메일 발송 완료!');
    
    // 보고서 미리보기 출력
    console.log('\n📋 생성된 Gemini Pro 보고서 미리보기:');
    console.log('='.repeat(60));
    console.log(geminiReport.substring(0, 500) + '...');
    console.log('='.repeat(60));
    
    console.log('\n🎉 Gemini Pro 보고서 발송 완료!');
    
  } catch (error) {
    console.error('❌ Gemini Pro 보고서 발송 실패:', error);
    
    // 실패 시에도 알림 이메일 발송
    try {
      const failureReport = `
# ⚠️ Gemini Pro 보고서 생성 실패

**실패 시간**: ${new Date().toLocaleString('ko-KR')}
**오류 메시지**: ${error.message}

**상태**: Gemini API 일시적 과부하 또는 연결 문제로 추정됩니다.
나중에 다시 시도해주세요.

---
*자동 생성된 실패 알림입니다*
      `.trim();
      
      const failureHtml = wrapInEmailTemplate(
        failureReport.replace(/\n/g, '<br>'), 
        'Gemini Pro 보고서 생성 실패 알림'
      );
      
      await sendReportEmail({
        subject: `❌ Gemini Pro 보고서 생성 실패 - ${new Date().toLocaleDateString('ko-KR')}`,
        html: failureHtml
      });
      
      console.log('📧 실패 알림 이메일 발송 완료');
    } catch (emailError) {
      console.error('📧 실패 알림 이메일 발송도 실패:', emailError.message);
    }
  }
}

// 스크립트 실행
if (require.main === module) {
  sendGeminiReport();
}