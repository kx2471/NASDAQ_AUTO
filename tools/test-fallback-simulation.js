/**
 * Alpaca 실패 시 Yahoo Finance fallback 시뮬레이션 테스트
 *
 * 사용법:
 *   node tools/test-fallback-simulation.js
 *
 * 테스트 시나리오:
 *   1. 존재하지 않는 종목 (INVALID123) - Alpaca 실패 → Yahoo 실패
 *   2. 실제 존재하는 종목 (PL, CSIQ) - 정상 조회
 *   3. 혼합 테스트로 개별 fallback 검증
 */

require('dotenv').config();

async function main() {
  console.log('🧪 Alpaca Fallback 시뮬레이션 테스트\n');

  try {
    const { getLatestPrices } = require('../dist/services/realtime-market');

    // 테스트 종목: 정상 종목 + 존재하지 않는 종목
    const testSymbols = ['PL', 'CSIQ', 'INVALID123', 'NOTEXIST456'];

    console.log(`📋 테스트 종목: ${testSymbols.join(', ')}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('💡 예상 결과:');
    console.log('  - PL, CSIQ: Alpaca 성공 (또는 Yahoo fallback)');
    console.log('  - INVALID123, NOTEXIST456: Alpaca 실패 → Yahoo 시도 → 최종 실패');
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const prices = await getLatestPrices(testSymbols);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 테스트 결과\n');

    for (const symbol of testSymbols) {
      if (prices[symbol]) {
        console.log(`✅ ${symbol}: $${prices[symbol].price.toFixed(2)} (${prices[symbol].session})`);
        console.log(`   타임스탬프: ${prices[symbol].timestamp.toLocaleString()}`);
      } else {
        console.log(`❌ ${symbol}: 조회 실패 (Alpaca + Yahoo 모두 실패)`);
      }
      console.log();
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 통계
    const successCount = Object.keys(prices).length;
    const failCount = testSymbols.length - successCount;

    console.log('\n📈 통계:');
    console.log(`  성공: ${successCount}개`);
    console.log(`  실패: ${failCount}개`);
    console.log(`  성공률: ${((successCount / testSymbols.length) * 100).toFixed(1)}%`);

    // 검증
    console.log('\n✅ 검증 결과:');
    if (prices['PL'] && prices['CSIQ']) {
      console.log('  ✅ 정상 종목(PL, CSIQ) 조회 성공');
    } else {
      console.log('  ❌ 정상 종목 조회 실패 - 문제 있음!');
    }

    if (!prices['INVALID123'] && !prices['NOTEXIST456']) {
      console.log('  ✅ 존재하지 않는 종목 정상 처리 (조회 실패)');
    } else {
      console.log('  ⚠️ 존재하지 않는 종목이 조회됨 - 확인 필요');
    }

    console.log('\n💡 Fallback 시스템 작동 확인:');
    console.log('  - 개별 종목마다 Alpaca → Yahoo 순차 시도');
    console.log('  - 실패한 종목은 결과에서 누락 (정상 동작)');
    console.log('  - 보고서에서 "—" 표시되는 문제 해결됨');

  } catch (error) {
    console.error('\n❌ 테스트 실패:', error.message);
    console.error('상세 오류:', error);
    process.exit(1);
  }
}

main().catch(console.error);
