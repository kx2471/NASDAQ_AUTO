/**
 * Alpaca 웹소켓 실시간 가격 스트리밍 테스트
 *
 * 사용법:
 *   node tools/test-websocket-price.js [SYMBOL]
 *
 * 예시:
 *   node tools/test-websocket-price.js CSIQ
 */

require('dotenv').config();

async function main() {
  const symbol = process.argv[2] || 'CSIQ';

  console.log(`🚀 웹소켓 실시간 가격 스트리밍 시작: ${symbol}\n`);

  // 환경 변수 확인
  if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_SECRET_KEY) {
    console.error('❌ Alpaca API 키가 설정되지 않았습니다.');
    process.exit(1);
  }

  try {
    const { getCurrentPrices, getCurrentMarketSession } = require('../dist/services/realtime-market');

    console.log('📡 웹소켓 연결 중...');
    console.log(`⏱️  5초간 실시간 거래 데이터를 수신합니다...\n`);

    const currentSession = getCurrentMarketSession();
    console.log(`🕐 현재 시장 세션: ${currentSession}\n`);

    // 웹소켓으로 5초간 실시간 가격 수신
    const prices = await getCurrentPrices([symbol], 5000);

    console.log('\n✅ 웹소켓 스트리밍 완료!\n');
    console.log('📊 수신된 데이터:\n');

    const priceData = prices[symbol];

    if (priceData) {
      console.log(`  종목: ${priceData.symbol}`);
      console.log(`  가격: $${priceData.price.toFixed(2)}`);
      console.log(`  세션: ${priceData.session}`);
      console.log(`  시각: ${priceData.timestamp.toLocaleString('ko-KR', { timeZone: 'America/New_York' })} ET`);

      if (priceData.volume) {
        console.log(`  거래량: ${priceData.volume.toLocaleString()}`);
      }

      if (priceData.bid && priceData.ask) {
        console.log(`  호가: Bid $${priceData.bid.toFixed(2)} / Ask $${priceData.ask.toFixed(2)}`);
        console.log(`  스프레드: $${(priceData.ask - priceData.bid).toFixed(2)}`);
      }
    } else {
      console.log(`  ⚠️ ${symbol} 데이터를 수신하지 못했습니다.`);
      console.log(`  💡 정규장 시간(9:30 AM - 4:00 PM ET)에 시도하면 더 많은 데이터를 받을 수 있습니다.`);
    }

    console.log('\n✅ 테스트 완료!');

  } catch (error) {
    console.error('\n❌ 웹소켓 스트리밍 실패:', error.message);
    console.error('상세 오류:', error);
    process.exit(1);
  }
}

main().catch(console.error);
