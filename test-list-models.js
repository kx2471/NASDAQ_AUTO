// 환경 변수 로드
require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');

/**
 * Gemini에서 사용 가능한 모델 목록 확인
 */
async function listAvailableModels() {
  console.log('🔍 Gemini 사용 가능한 모델 목록 확인 중...');
  
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다');
    }
    
    const ai = new GoogleGenAI({
      apiKey: apiKey
    });
    
    // 모델 목록 확인
    const models = await ai.models.list();
    
    console.log('✅ 사용 가능한 Gemini 모델 목록:');
    console.log('='.repeat(50));
    
    if (models && models.models) {
      models.models.forEach((model, index) => {
        console.log(`${index + 1}. ${model.name || model.displayName}`);
        if (model.description) {
          console.log(`   설명: ${model.description}`);
        }
        if (model.supportedGenerationMethods) {
          console.log(`   지원 메서드: ${model.supportedGenerationMethods.join(', ')}`);
        }
        console.log('');
      });
    } else {
      console.log('모델 목록을 가져올 수 없습니다.');
      console.log('응답:', JSON.stringify(models, null, 2));
    }
    
  } catch (error) {
    console.error('❌ 모델 목록 확인 실패:', error.message);
    console.error('상세 오류:', error);
  }
}

// 스크립트 실행
if (require.main === module) {
  listAvailableModels();
}