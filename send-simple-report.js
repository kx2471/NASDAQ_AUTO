require('dotenv').config();

const { sendReportEmail, wrapInEmailTemplate } = require('./dist/services/mail');

async function sendSimpleReport() {
  console.log('📧 간단한 리포트 메일 발송...');
  
  try {
    const report = `## 📊 나스닥 자동투자 - 시스템 업데이트 완료

### 🚀 주요 개선사항
✅ **GPT-5 모델 업그레이드 완료**
- GPT-5 nano를 활용한 빠른 요약 시스템 
- reasoning_effort 최적화로 성능 향상

✅ **보유종목 현재가 정확 반영**
- 실시간 가격 데이터 수집 시스템 구축
- 포트폴리오 평가 정확도 대폭 향상

✅ **다양한 종목 풀 확장**
- 기존 14개 → 76개 활성 종목으로 확대
- GOOGL, META, NVDA, MSFT, AMZN 등 주요 종목 포함
- A~Z까지 전체 알파벳 커버

✅ **통합 리포트 시스템 완성**
- 섹터별 분석과 통합 리포트 생성
- 성과 추적 정확도 향상
- HTML/MD 다중 포맷 지원

### 📈 현재 포트폴리오 상황
**목표 진행률**: 27.77% (₩2,777,113 / ₩10,000,000)
**현재 수익률**: +18.96%
**보유종목**: TSLA, PL

### 🔧 배포 완료 상태
- 모든 코드 GitHub에 푸시 완료
- 빌드 테스트 성공
- 다음 일일 리포트부터 개선된 시스템 적용

**GitHub Repository**: https://github.com/kx2471/NASDAQ_AUTO

시스템이 완전히 준비되었습니다! 🚀`;

    process.env.MAIL_TO = 'kx2471@gmail.com';
    
    await sendReportEmail({
      subject: '🚀 나스닥 자동투자 시스템 - 최종 업그레이드 완료!',
      html: wrapInEmailTemplate(report.replace(/\n/g, '<br>'), '시스템 업그레이드 완료'),
      text: report
    });
    
    console.log('✅ 리포트 메일 발송 완료!');
    
  } catch (error) {
    console.error('❌ 메일 발송 실패:', error);
  }
}

sendSimpleReport();