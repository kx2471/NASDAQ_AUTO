/**
 * Alpaca 실시간 가격 조회 테스트 스크립트
 *
 * 사용법:
 *   node tools/test-realtime-price.js
 *
 * 기능:
 *   - 보유 종목의 실시간 가격 조회
 *   - 프리마켓/정규장/애프터마켓 세션 확인
 *   - Alpaca API 연결 테스트
 */

require('dotenv').config();

async function main() {
  console.log('🚀 Alpaca 실시간 가격 조회 테스트 시작\n');

  // 1. 환경 변수 확인
  console.log('📋 환경 변수 확인:');
  console.log(`  ALPACA_API_KEY: ${process.env.ALPACA_API_KEY ? '✅ 설정됨' : '❌ 미설정'}`);
  console.log(`  ALPACA_SECRET_KEY: ${process.env.ALPACA_SECRET_KEY ? '✅ 설정됨' : '❌ 미설정'}`);
  console.log(`  ALPACA_PAPER: ${process.env.ALPACA_PAPER || 'true'}\n`);

  if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_SECRET_KEY) {
    console.error('❌ Alpaca API 키가 설정되지 않았습니다.');
    console.log('\n📝 설정 방법:');
    console.log('1. https://alpaca.markets 에서 무료 계정 생성');
    console.log('2. API 키 발급 (Paper Trading)');
    console.log('3. .env 파일에 다음 추가:');
    console.log('   ALPACA_API_KEY=your-api-key');
    console.log('   ALPACA_SECRET_KEY=your-secret-key');
    console.log('   ALPACA_PAPER=true');
    process.exit(1);
  }

  try {
    // 2. 실시간 가격 조회 서비스 import
    const { getLatestPrices, getCurrentMarketSession, isRealtimePriceEnabled } = require('../dist/services/realtime-market');

    // 3. 서비스 활성화 확인
    console.log('🔍 실시간 가격 서비스 상태:');
    const isEnabled = isRealtimePriceEnabled();
    console.log(`  활성화: ${isEnabled ? '✅ YES' : '❌ NO'}\n`);

    if (!isEnabled) {
      console.error('❌ 실시간 가격 서비스가 비활성화되어 있습니다.');
      process.exit(1);
    }

    // 4. 현재 시장 세션 확인
    console.log('🕐 현재 시장 세션:');
    const currentSession = getCurrentMarketSession();
    const sessionDescription = {
      'PRE': '프리마켓 (4:00-9:30 AM ET)',
      'REGULAR': '정규장 (9:30 AM-4:00 PM ET)',
      'POST': '애프터마켓 (4:00-8:00 PM ET)',
      'CLOSED': '장 마감'
    };
    console.log(`  ${currentSession} - ${sessionDescription[currentSession]}\n`);

    // 5. 보유 종목 조회
    console.log('📊 보유 종목 조회:');
    const { getHoldings } = require('../dist/storage/database');
    const holdings = await getHoldings();

    if (holdings.length === 0) {
      console.log('  ⚠️ 보유 종목이 없습니다.\n');
      console.log('  테스트용 종목으로 AAPL, MSFT, NVDA 사용...\n');
      const testSymbols = ['AAPL', 'MSFT', 'NVDA'];

      console.log('💰 실시간 가격 조회 중...\n');
      const prices = await getLatestPrices(testSymbols);

      console.log('✅ 실시간 가격 조회 완료:\n');
      for (const [symbol, priceData] of Object.entries(prices)) {
        console.log(`  ${symbol}:`);
        console.log(`    가격: $${priceData.price.toFixed(2)}`);
        console.log(`    세션: ${priceData.session}`);
        console.log(`    시각: ${priceData.timestamp.toLocaleString('ko-KR', { timeZone: 'America/New_York' })} ET`);
        if (priceData.volume) {
          console.log(`    거래량: ${priceData.volume.toLocaleString()}`);
        }
        console.log('');
      }
    } else {
      const symbols = holdings.map(h => h.symbol);
      console.log(`  종목: ${symbols.join(', ')}\n`);

      console.log('💰 실시간 가격 조회 중...\n');
      const prices = await getLatestPrices(symbols);

      console.log('✅ 실시간 가격 조회 완료:\n');
      for (const holding of holdings) {
        const priceData = prices[holding.symbol];
        if (priceData) {
          const currentValue = holding.shares * priceData.price;
          const costBasis = holding.shares * holding.avg_cost;
          const profit = currentValue - costBasis;
          const profitPercent = ((profit / costBasis) * 100).toFixed(2);

          console.log(`  ${holding.symbol}:`);
          console.log(`    현재가: $${priceData.price.toFixed(2)} (${priceData.session})`);
          console.log(`    평균단가: $${holding.avg_cost.toFixed(2)}`);
          console.log(`    보유수량: ${holding.shares}주`);
          console.log(`    평가액: $${currentValue.toFixed(2)}`);
          console.log(`    손익: $${profit.toFixed(2)} (${profitPercent}%)`);
          console.log(`    조회시각: ${priceData.timestamp.toLocaleString('ko-KR', { timeZone: 'America/New_York' })} ET`);
          console.log('');
        }
      }
    }

    console.log('✅ 테스트 완료!\n');

  } catch (error) {
    console.error('❌ 테스트 실패:', error.message);
    console.error('\n상세 오류:', error);
    process.exit(1);
  }
}

main().catch(console.error);
