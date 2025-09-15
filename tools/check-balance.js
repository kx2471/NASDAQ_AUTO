const trades = require('../data/json/trades.json');
const cashEvents = require('../data/json/cash_events.json');

console.log('=== 거래 내역 분석 ===');
let balance = 0;

// 초기 입금
cashEvents.forEach(event => {
  console.log(`입금: $${event.amount}`);
  balance += event.amount;
});

console.log(`초기 잔고: $${balance.toFixed(2)}`);

// 거래 내역
trades.forEach(trade => {
  if (trade.side === 'BUY') {
    const cost = trade.qty * trade.price;
    balance -= cost;
    console.log(`매수 ${trade.symbol}: ${trade.qty}주 x $${trade.price} = -$${cost.toFixed(2)} (잔고: $${balance.toFixed(2)})`);
  } else if (trade.side === 'SELL') {
    const proceeds = trade.qty * trade.price;
    balance += proceeds;
    console.log(`매도 ${trade.symbol}: ${trade.qty}주 x $${trade.price} = +$${proceeds.toFixed(2)} (잔고: $${balance.toFixed(2)})`);
  }
});

console.log(`\n최종 현금 잔고: $${balance.toFixed(2)}`);

// 환율 계산 (1391.7원/달러)
const krwBalance = balance * 1391.7;
console.log(`원화 환산: ₩${Math.round(krwBalance).toLocaleString()}`);

// 270만원이면 달러로 얼마인지 계산
const targetKrw = 2700000;
const targetUsd = targetKrw / 1391.7;
console.log(`\n₩270만원 = $${targetUsd.toFixed(2)}`);