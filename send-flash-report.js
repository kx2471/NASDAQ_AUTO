// 환경 변수 로드
require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');
const { sendReportEmail, wrapInEmailTemplate } = require('./dist/services/mail');
const fs = require('fs/promises');
const path = require('path');

/**
 * Gemini Flash로 실제 보고서 생성 및 발송
 */
async function sendFlashReport() {
  console.log('⚡ Gemini Flash 보고서 즉시 발송 시작...');
  
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다');
    }
    
    const ai = new GoogleGenAI({
      apiKey: apiKey
    });
    
    // 투자 분석 프롬프트 생성
    const investmentPrompt = `당신은 전문 주식 투자 분석가입니다. 다음 데이터를 바탕으로 종합적인 투자 리포트를 작성해주세요.

**분석 기준일**: ${new Date().toLocaleDateString('ko-KR')}

**주요 종목 분석**:
- GOOGL (Alphabet): $195.32 - AI/클라우드 섹터
  기술지표: EMA20 $195.32, EMA50 $185.20, RSI 65.4
- NVDA (NVIDIA): $138.07 - AI 반도체 섹터  
  기술지표: EMA20 $138.07, EMA50 $135.80, RSI 58.2
- MSFT (Microsoft): $441.58 - 클라우드 섹터
  기술지표: EMA20 $441.58, EMA50 $435.90, RSI 62.1
- AAPL (Apple): $225.77 - 테크 섹터
  기술지표: EMA20 $225.77, EMA50 $220.30, RSI 55.8
- META (Meta): $558.52 - AI/메타버스 섹터
  기술지표: EMA20 $558.52, EMA50 $545.20, RSI 68.9

**주요 뉴스**:
- AI 반도체 수요 급증으로 NVIDIA 실적 전망 상향
- Google Cloud AI 서비스 매출 30% 증가  
- Microsoft Copilot 사용자 1억명 돌파
- Meta AI 모델 Llama 3 기업 도입 확산
- 애플 iPhone AI 기능 사용률 증가세

**요청사항**:
1. **시장 개요**: 현재 AI/테크 시장 상황 및 트렌드 분석
2. **섹터 분석**: AI, 클라우드, 테크 섹터별 전망
3. **종목 추천**: 상위 3개 종목 선별 및 구체적 근거
   - 각 종목별 진입가, 목표가, 손절가 제시
   - 기술적 분석 (EMA, RSI 등) 활용
4. **투자 전략**: 향후 1-2주 실행 계획

**형식 요구사항**:
- 명확하고 구체적인 수치 제시
- 실행 가능한 투자 가이드 제공
- 전문적이면서도 이해하기 쉬운 설명

한국어로 작성해주세요.`;

    // Gemini Flash로 보고서 생성
    console.log('⚡ Gemini 1.5 Flash Latest로 보고서 생성 중...');
    
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash-latest',
      contents: investmentPrompt,
      config: {
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 8192,
      }
    });
    
    if (!response.text) {
      throw new Error('Gemini Flash에서 응답을 받지 못했습니다');
    }
    
    const flashReport = response.text;
    console.log('✅ Gemini Flash 보고서 생성 성공!');
    console.log(`📄 보고서 길이: ${flashReport.length} 문자`);
    
    // 보고서 파일 저장
    const reportDir = path.join(process.cwd(), 'data', 'report');
    await fs.mkdir(reportDir, { recursive: true });
    
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const time = new Date().toTimeString().substr(0, 5).replace(':', '');
    const mdPath = path.join(reportDir, `${today}_${time}_gemini_flash.md`);
    
    await fs.writeFile(mdPath, flashReport, 'utf8');
    console.log('💾 Flash 보고서 파일 저장:', mdPath);
    
    // 이메일 발송
    console.log('📧 Gemini Flash 보고서 이메일 발송 중...');
    
    const emailHtml = wrapInEmailTemplate(
      flashReport.replace(/\n/g, '<br>'), 
      `⚡ Gemini Flash 투자 리포트 (${new Date().toLocaleDateString('ko-KR')} ${new Date().toLocaleTimeString('ko-KR')})`
    );
    
    await sendReportEmail({
      subject: `⚡ Gemini Flash 투자 리포트 - ${new Date().toLocaleDateString('ko-KR')} ${new Date().toLocaleTimeString('ko-KR')}`,
      html: emailHtml,
      mdPath: mdPath
    });
    
    console.log('✅ 이메일 발송 완료!');
    
    // 보고서 미리보기 출력
    console.log('\n📋 생성된 Gemini Flash 보고서 미리보기:');
    console.log('='.repeat(60));
    console.log(flashReport.substring(0, 800) + '...');
    console.log('='.repeat(60));
    
    console.log('\n🎉 Gemini Flash 보고서 발송 완료! (과부하 해결!)');
    
  } catch (error) {
    console.error('❌ Gemini Flash 보고서 발송 실패:', error);
  }
}

// 스크립트 실행
if (require.main === module) {
  sendFlashReport();
}