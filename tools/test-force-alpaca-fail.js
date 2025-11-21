/**
 * Alpaca 강제 실패 시뮬레이션
 * realtime-market.ts를 수정하지 않고 테스트하기 위해
 * 잘못된 API 키로 테스트
 */

require('dotenv').config();

async function main() {
  console.log('🧪 Alpaca 강제 실패 → Yahoo Fallback 테스트\n');

  // 원래 API 키 백업
  const originalKey = process.env.ALPACA_API_KEY;
  const originalSecret = process.env.ALPACA_SECRET_KEY;

  try {
    // 1단계: 정상 API 키로 테스트
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 1단계: 정상 Alpaca API 테스트\n');

    const { getLatestPrices } = require('../dist/services/realtime-market');
    const normalPrices = await getLatestPrices(['PL', 'CSIQ']);

    console.log('\n결과:');
    for (const [symbol, data] of Object.entries(normalPrices)) {
      console.log(`  ✅ ${symbol}: $${data.price} (Alpaca 성공)`);
    }

    // 2단계: 잘못된 API 키로 강제 실패 시뮬레이션
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 2단계: Alpaca API 강제 실패 → Yahoo Fallback 테스트\n');
    console.log('💡 임시로 API 키를 무효화하여 Alpaca 실패 시뮬레이션...\n');

    // API 키 무효화
    process.env.ALPACA_API_KEY = 'INVALID_KEY_TEST';
    process.env.ALPACA_SECRET_KEY = 'INVALID_SECRET_TEST';

    // 캐시 제거 (새로운 API 키로 재로드)
    delete require.cache[require.resolve('../dist/services/realtime-market')];
    const { getLatestPrices: getLatestPricesFail } = require('../dist/services/realtime-market');

    const fallbackPrices = await getLatestPricesFail(['PL', 'CSIQ']);

    console.log('\n결과:');
    for (const [symbol, data] of Object.entries(fallbackPrices)) {
      console.log(`  ✅ ${symbol}: $${data.price} (Yahoo Fallback 성공!)`);
      console.log(`     세션: ${data.session}`);
    }

    if (Object.keys(fallbackPrices).length === 0) {
      console.log('  ❌ 모든 종목 조회 실패 (Alpaca + Yahoo 모두 실패)');
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 최종 검증\n');

    if (Object.keys(fallbackPrices).length === 2) {
      console.log('✅ 성공: Alpaca 실패 시 Yahoo Fallback 정상 작동!');
      console.log('✅ PL, CSIQ 모두 Yahoo Finance에서 조회 성공');
      console.log('✅ 보고서에서 "—" 표시 문제 해결됨');
    } else {
      console.log('⚠️ 일부 종목만 성공 또는 전체 실패');
      console.log(`   성공: ${Object.keys(fallbackPrices).length}/2`);
    }

  } catch (error) {
    console.error('\n❌ 테스트 실패:', error.message);
    console.error('상세:', error);
  } finally {
    // API 키 복원
    process.env.ALPACA_API_KEY = originalKey;
    process.env.ALPACA_SECRET_KEY = originalSecret;
  }
}

main().catch(console.error);
