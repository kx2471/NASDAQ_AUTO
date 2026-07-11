// 토스 실계좌 잔고·보유 확인 도구
// 사용법: npm run build && node tools/check-balance.js
// (잔고의 정답은 토스 실계좌 — 과거의 cash_events.json 재생 방식은 폐기됨)
import dotenv from 'dotenv';
dotenv.config();

async function checkBalance() {
  try {
    const { getCashBalance, getHoldings } = await import('../dist/storage/database.js');
    const { getCachedExchangeRate } = await import('../dist/services/exchange.js');

    const [cash, holdings, rate] = await Promise.all([
      getCashBalance(),
      getHoldings(),
      getCachedExchangeRate()
    ]);

    console.log('💰 토스 실계좌 현황');
    console.log('─'.repeat(40));
    console.log(`현금(매수가능 USD): $${cash.toFixed(2)} (₩${Math.round(cash * rate.usd_to_krw).toLocaleString()})`);
    console.log(`환율: ${rate.usd_to_krw} 원/달러`);
    console.log('─'.repeat(40));

    if (holdings.length === 0) {
      console.log('보유종목 없음');
    } else {
      for (const h of holdings) {
        const cur = h.currency || 'USD';
        console.log(`${h.symbol.padEnd(8)} ${h.shares}주 @ ${cur === 'KRW' ? '₩' : '$'}${h.avg_cost.toLocaleString()} (${cur})`);
      }
    }
  } catch (error) {
    console.error('❌ 조회 실패:', error.message);
    process.exit(1);
  }
}

checkBalance();
