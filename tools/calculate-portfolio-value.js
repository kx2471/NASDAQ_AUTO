const trades = require('../data/json/trades.json');
const cashEvents = require('../data/json/cash_events.json');

console.log('=== 포트폴리오 가치 계산 ===');

/**
 * 평단가 계산 방식: totalCost / buyShares (전체 매수량 기준)
 * - buyShares: 총 매수한 주식 수 (매도 시 변경 안함)
 * - totalCost: 총 매수 비용 (매도 시 변경 안함)
 * - qty: 현재 보유량 (BUY +, SELL -)
 */
const holdings = {};
trades.forEach(trade => {
  if (!holdings[trade.symbol]) {
    holdings[trade.symbol] = { qty: 0, buyShares: 0, totalCost: 0 };
  }

  if (trade.side === 'BUY') {
    holdings[trade.symbol].qty += trade.qty;
    holdings[trade.symbol].buyShares += trade.qty;
    holdings[trade.symbol].totalCost += trade.qty * trade.price;
  } else if (trade.side === 'SELL') {
    holdings[trade.symbol].qty -= trade.qty;
    // 이동평균법: 매도 시 totalCost와 buyShares 비례 감소
    if (Math.abs(holdings[trade.symbol].qty) < 0.0001) {
      // 전량 매도: 리셋
      holdings[trade.symbol].totalCost = 0;
      holdings[trade.symbol].buyShares = 0;
      holdings[trade.symbol].qty = 0;
    } else if (holdings[trade.symbol].buyShares > 0) {
      // 부분 매도: 평단가 기준으로 비례 감소
      const avgCost = holdings[trade.symbol].totalCost / holdings[trade.symbol].buyShares;
      holdings[trade.symbol].buyShares -= trade.qty;
      holdings[trade.symbol].totalCost = holdings[trade.symbol].buyShares * avgCost;
    }
  }
});

console.log('\n📊 현재 보유 종목:');
let totalHoldingValue = 0;
Object.entries(holdings).forEach(([symbol, data]) => {
  // 부동소수점 오차를 고려하여 0.0001주 이상인 경우만 표시
  if (data.qty >= 0.0001) {
    // 평단가 = totalCost / buyShares (전체 매수량 기준)
    const avgPrice = data.buyShares > 0 ? data.totalCost / data.buyShares : 0;
    const currentValue = data.qty * avgPrice; // 매수가격 기준
    totalHoldingValue += currentValue;
    console.log(`${symbol}: ${data.qty.toFixed(6)}주 @ $${avgPrice.toFixed(2)} = $${currentValue.toFixed(2)}`);
  }
});

console.log(`\n💰 총 보유종목 가치: $${totalHoldingValue.toFixed(2)}`);

// 입금 총액
let totalDeposit = 0;
cashEvents.forEach(event => {
  if (event.type === 'DEPOSIT') {
    totalDeposit += event.amount;
  }
});
console.log(`💵 총 입금액: $${totalDeposit.toFixed(2)}`);

// 차이 확인
const difference = totalHoldingValue - totalDeposit;
console.log(`📈 차이: $${difference.toFixed(2)}`);

if (Math.abs(difference) < 10) {
  console.log('✅ 거의 일치 - 현금 잔고는 거의 $0');
} else if (difference > 0) {
  console.log('❌ 보유가치가 입금보다 큼 - 데이터 오류');
} else {
  console.log(`💰 남은 현금: $${Math.abs(difference).toFixed(2)}`);
}

// 환율 계산
const exchangeRate = 1391.7;
console.log(`\n🌏 원화 환산 (${exchangeRate}원/달러):`);
console.log(`보유종목: ₩${Math.round(totalHoldingValue * exchangeRate).toLocaleString()}`);
console.log(`입금액: ₩${Math.round(totalDeposit * exchangeRate).toLocaleString()}`);