// 환경 변수 로드
require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');

/**
 * Gemini Flash 모델로 테스트 (과부하 회피)
 */
async function testGeminiFlash() {
  console.log('🚀 Gemini Flash 모델 테스트 시작...');
  
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다');
    }
    
    const ai = new GoogleGenAI({
      apiKey: apiKey
    });
    
    // 1. Flash Latest 모델 테스트
    console.log('\n🔥 Gemini 1.5 Flash Latest 테스트...');
    try {
      const response1 = await ai.models.generateContent({
        model: 'gemini-1.5-flash-latest',
        contents: `
안녕하세요! 간단한 투자 리포트를 작성해주세요.

**종목 데이터**:
- GOOGL: $195.32 (AI/클라우드 섹터)
- NVDA: $138.07 (AI 반도체 섹터)

**요청**: 이 2개 종목에 대한 간단한 투자 분석을 한국어로 300자 내외로 작성해주세요.
        `
      });
      
      if (response1.text) {
        console.log('✅ Flash Latest 성공!');
        console.log(`📝 응답 길이: ${response1.text.length} 문자`);
        console.log('📄 응답 미리보기:', response1.text.substring(0, 200) + '...');
      }
    } catch (error) {
      console.error('❌ Flash Latest 실패:', error.message);
    }
    
    // 2. 2.0 Flash 모델 테스트
    console.log('\n🚀 Gemini 2.0 Flash 테스트...');
    try {
      const response2 = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: `
안녕하세요! 간단한 투자 리포트를 작성해주세요.

**종목 데이터**:
- MSFT: $441.58 (클라우드 섹터)
- META: $558.52 (AI/메타버스 섹터)

**요청**: 이 2개 종목에 대한 간단한 투자 분석을 한국어로 300자 내외로 작성해주세요.
        `
      });
      
      if (response2.text) {
        console.log('✅ 2.0 Flash 성공!');
        console.log(`📝 응답 길이: ${response2.text.length} 문자`);
        console.log('📄 응답 미리보기:', response2.text.substring(0, 200) + '...');
      }
    } catch (error) {
      console.error('❌ 2.0 Flash 실패:', error.message);
    }
    
    // 3. 기존 2.5 Pro 테스트 (비교용)
    console.log('\n🤖 Gemini 2.5 Pro 테스트 (비교용)...');
    try {
      const response3 = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: 'Hello, just reply OK'
      });
      
      if (response3.text) {
        console.log('✅ 2.5 Pro 성공! (과부하 해결됨?)');
      }
    } catch (error) {
      console.error('❌ 2.5 Pro 여전히 실패:', error.message);
    }
    
    console.log('\n🎯 결론: Flash 모델들이 더 안정적일 수 있습니다!');
    
  } catch (error) {
    console.error('❌ 전체 테스트 실패:', error);
  }
}

// 스크립트 실행
if (require.main === module) {
  testGeminiFlash();
}