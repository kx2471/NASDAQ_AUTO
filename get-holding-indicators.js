const { fetchDailyPrices, computeIndicators } = require('./dist/services/market');
const { getCachedExchangeRate } = require('./dist/services/exchange');

async function getHoldingIndicators() {
  console.log('📊 보유 종목 기술지표 수집...');
  
  try {
    const [data, exchangeRate] = await Promise.all([
      fetchDailyPrices(['TSLA', 'PL']),
      getCachedExchangeRate()
    ]);
    
    console.log('💱 현재 환율: USD/KRW =', exchangeRate.usd_to_krw.toFixed(2));
    console.log();
    
    for(const [symbol, prices] of Object.entries(data)) {
      if(prices && prices.length >= 50) {
        const closePrices = prices.map(p => p.close);
        const indicators = computeIndicators(closePrices);
        const currentPrice = closePrices[closePrices.length-1];
        
        console.log(`${symbol} 기술지표:`);
        console.log(`  현재가: $${currentPrice.toFixed(2)}`);
        console.log(`  RSI14: ${indicators.rsi14.toFixed(2)}`);
        console.log(`  EMA20: $${indicators.ema20.toFixed(2)}`);
        console.log(`  EMA50: $${indicators.ema50.toFixed(2)}`);
        console.log(`  원화 환산: ₩${(currentPrice * exchangeRate.usd_to_krw).toLocaleString()}`);
        console.log();
      } else {
        console.log(`${symbol}: 데이터 부족 (${prices ? prices.length : 0}일)`);
      }
    }
  } catch (error) {
    console.error('❌ 기술지표 수집 실패:', error);
  }
}

getHoldingIndicators();