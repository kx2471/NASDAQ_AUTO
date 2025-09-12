require('dotenv').config();

const { saveReportRecord } = require('./dist/storage/database');

/**
 * 리포트 기록 저장 기능 테스트
 */
async function testReportLogging() {
  console.log('📝 리포트 기록 저장 테스트 시작...');

  try {
    // 성공한 리포트 기록 추가
    const successReport = await saveReportRecord({
      generated_at: new Date().toISOString(),
      type: 'MANUAL',
      status: 'SUCCESS',
      ai_model: 'gpt-5-test',
      symbols_analyzed: 45,
      file_path: '/data/report/test_20250912.md',
      summary: '테스트 리포트: 45개 종목 분석 완료, 2.5초 소요',
      processing_time_ms: 2500
    });
    console.log('✅ 성공 리포트 기록:', successReport);

    // 실패한 리포트 기록 추가
    const failedReport = await saveReportRecord({
      generated_at: new Date(Date.now() - 60000).toISOString(), // 1분 전
      type: 'UNIFIED',
      status: 'FAILED',
      ai_model: 'gpt-5',
      symbols_analyzed: 0,
      error_message: 'API 연결 실패: 네트워크 오류',
      summary: '통합 리포트 실패: 5.2초 후 오류 발생',
      processing_time_ms: 5200
    });
    console.log('✅ 실패 리포트 기록:', failedReport);

    // 부분 성공 리포트 기록 추가
    const partialReport = await saveReportRecord({
      generated_at: new Date(Date.now() - 120000).toISOString(), // 2분 전
      type: 'SECTOR',
      status: 'PARTIAL',
      ai_model: 'gpt-5',
      symbols_analyzed: 25,
      file_path: '/data/report/sector_test_20250912.md',
      summary: '섹터 리포트 부분 성공: 25개 종목 분석, 일부 데이터 누락',
      processing_time_ms: 3800,
      error_message: '일부 종목의 가격 데이터 수집 실패'
    });
    console.log('✅ 부분성공 리포트 기록:', partialReport);

    console.log('\n🎉 리포트 기록 저장 테스트 완료!');

  } catch (error) {
    console.error('❌ 리포트 기록 테스트 실패:', error);
  }
}

testReportLogging();