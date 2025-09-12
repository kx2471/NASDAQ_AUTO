// 환경 변수 로드
require('dotenv').config();

const { sendReportEmail, wrapInEmailTemplate } = require('./dist/services/mail');
const fs = require('fs/promises');
const path = require('path');

/**
 * 생성된 GPT-5와 Gemini Pro 보고서를 모두 이메일로 발송
 */
async function sendEmailReports() {
  console.log('📧 GPT-5와 Gemini Pro 보고서 이메일 발송 시작...');
  
  try {
    const reportDir = path.join(process.cwd(), 'data', 'report');
    
    // 1. GPT-5 보고서 읽기
    const gptPath = path.join(reportDir, '20250912_test_gpt5.md');
    const gptReport = await fs.readFile(gptPath, 'utf8');
    console.log(`📄 GPT-5 보고서 로드: ${gptReport.length} 문자`);
    
    // 2. Gemini Pro 보고서 읽기  
    const geminiPath = path.join(reportDir, '20250912_test_gemini.md');
    const geminiReport = await fs.readFile(geminiPath, 'utf8');
    console.log(`📄 Gemini Pro 보고서 로드: ${geminiReport.length} 문자`);
    
    // 3. GPT-5 보고서 이메일 발송
    console.log('📧 GPT-5 보고서 이메일 발송 중...');
    
    const gptEmailHtml = wrapInEmailTemplate(
      gptReport.replace(/\n/g, '<br>'),
      `🤖 GPT-5 투자 리포트 (${new Date().toLocaleDateString('ko-KR')} ${new Date().toLocaleTimeString('ko-KR')})`
    );
    
    await sendReportEmail({
      subject: `🤖 GPT-5 투자 리포트 - ${new Date().toLocaleDateString('ko-KR')} ${new Date().toLocaleTimeString('ko-KR')}`,
      html: gptEmailHtml,
      mdPath: gptPath
    });
    
    console.log('✅ GPT-5 이메일 발송 완료!');
    
    // 4. Gemini Pro 보고서 이메일 발송
    console.log('📧 Gemini Pro 보고서 이메일 발송 중...');
    
    const geminiEmailHtml = wrapInEmailTemplate(
      geminiReport.replace(/\n/g, '<br>'),
      `⚡ Gemini Pro 투자 리포트 (${new Date().toLocaleDateString('ko-KR')} ${new Date().toLocaleTimeString('ko-KR')})`
    );
    
    await sendReportEmail({
      subject: `⚡ Gemini Pro 투자 리포트 - ${new Date().toLocaleDateString('ko-KR')} ${new Date().toLocaleTimeString('ko-KR')}`,
      html: geminiEmailHtml,
      mdPath: geminiPath
    });
    
    console.log('✅ Gemini Pro 이메일 발송 완료!');
    
    // 5. 요약 정보
    console.log('\n📊 발송 완료 요약:');
    console.log('- GPT-5 보고서: ✅ 발송 완료');
    console.log('- Gemini Pro 보고서: ✅ 발송 완료');
    console.log('- 수신자: kx2471@gmail.com');
    console.log('- 두 보고서 모두 서로 다른 AI 관점으로 투자 분석 제공');
    
    console.log('\n🎉 이중 AI 보고서 이메일 발송 성공!');
    
  } catch (error) {
    console.error('❌ 이메일 발송 실패:', error);
  }
}

// 스크립트 실행
if (require.main === module) {
  sendEmailReports();
}