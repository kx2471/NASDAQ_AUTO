/**
 * 기술지표 보완 시스템 테스트
 *
 * 사용법:
 *   node tools/test-technical-indicators.js PL
 *
 * 기능:
 *   - Yahoo Finance 데이터로 기술지표 계산 시도
 *   - 실패 시 Alpaca API로 히스토리 데이터 조회
 *   - 기술지표 재계산 및 표시
 */

require('dotenv').config();

async function main() {
  const symbol = process.argv[2] || 'PL';

  console.log(`🚀 ${symbol} 기술지표 계산 테스트\n`);

  try {
    // 1. Yahoo Finance 데이터 조회
    console.log('📊 Step 1: Yahoo Finance 데이터 조회...');
    const { fetchDailyPrices, computeIndicators, computeIndicatorsPartial } = require('../dist/services/market');

    const yahooData = await fetchDailyPrices([symbol]);
    const yahooPrices = yahooData[symbol];

    console.log(`   Yahoo Finance: ${yahooPrices?.length || 0}일 데이터 수집`);

    if (yahooPrices && yahooPrices.length >= 50) {
      console.log('   ✅ 충분한 데이터 확보, 기술지표 계산 가능\n');

      const closePrices = yahooPrices.map(p => p.close);
      const indicators = computeIndicators(closePrices);

      console.log('📈 Yahoo Finance 기술지표:');
      console.log(`   현재가: $${closePrices[closePrices.length - 1].toFixed(2)}`);
      console.log(`   EMA20: $${indicators.ema20.toFixed(2)}`);
      console.log(`   EMA50: $${indicators.ema50.toFixed(2)}`);
      console.log(`   RSI14: ${indicators.rsi14.toFixed(2)}`);

      console.log('\n✅ Yahoo Finance 데이터로 충분합니다!');
      process.exit(0);
    } else {
      console.log(`   ⚠️ 데이터 부족 (${yahooPrices?.length || 0}일) - Alpaca 보완 시도\n`);
    }

    // 2. Alpaca API 데이터 조회
    console.log('📊 Step 2: Alpaca API 히스토리 데이터 조회...');

    if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_SECRET_KEY) {
      console.error('   ❌ Alpaca API 키가 설정되지 않았습니다.');
      console.log('\n💡 해결 방법:');
      console.log('   1. .env 파일에 ALPACA_API_KEY 추가');
      console.log('   2. .env 파일에 ALPACA_SECRET_KEY 추가');
      process.exit(1);
    }

    const { getHistoricalPrices } = require('../dist/services/realtime-market');
    const alpacaPrices = await getHistoricalPrices(symbol, 100);

    console.log(`   Alpaca API: ${alpacaPrices.length}일 데이터 수집\n`);

    if (alpacaPrices.length >= 50) {
      console.log('   ✅ 충분한 데이터 확보, 기술지표 계산 시작...\n');

      const closePrices = alpacaPrices.map(p => p.close);
      const indicators = computeIndicators(closePrices);

      console.log('📈 Alpaca API 기술지표:');
      console.log(`   현재가: $${closePrices[closePrices.length - 1].toFixed(2)}`);
      console.log(`   EMA20: $${indicators.ema20.toFixed(2)}`);
      console.log(`   EMA50: $${indicators.ema50.toFixed(2)}`);
      console.log(`   RSI14: ${indicators.rsi14.toFixed(2)}`);

      console.log('\n✅ Alpaca 데이터로 기술지표 계산 성공!');

      // 샘플 데이터 표시
      console.log('\n📋 최근 5일 가격 데이터:');
      const recentPrices = alpacaPrices.slice(-5);
      recentPrices.forEach(p => {
        console.log(`   ${p.date}: $${p.close.toFixed(2)} (Vol: ${p.volume.toLocaleString()})`);
      });

    } else if (alpacaPrices.length >= 15) {
      console.log('   ⚠️ 부분 데이터만 확보, 부분 기술지표 계산...\n');

      const closePrices = alpacaPrices.map(p => p.close);
      const indicators = computeIndicatorsPartial(closePrices);

      console.log('📈 Alpaca API 부분 기술지표:');
      console.log(`   현재가: $${closePrices[closePrices.length - 1].toFixed(2)}`);
      if (indicators.ema20) console.log(`   EMA20: $${indicators.ema20.toFixed(2)}`);
      if (indicators.ema50) console.log(`   EMA50: $${indicators.ema50.toFixed(2)}`);
      if (indicators.rsi14) console.log(`   RSI14: ${indicators.rsi14.toFixed(2)}`);

      console.log('\n⚠️ 부분 기술지표만 계산 가능합니다.');
    } else {
      console.log(`   ❌ Alpaca 데이터도 부족 (${alpacaPrices.length}일)`);
      console.log('\n💡 이 종목은 최근 상장된 종목이거나 거래가 매우 적은 종목입니다.');
    }

  } catch (error) {
    console.error('\n❌ 테스트 실패:', error.message);
    console.error('상세 오류:', error);
    process.exit(1);
  }
}

main().catch(console.error);
