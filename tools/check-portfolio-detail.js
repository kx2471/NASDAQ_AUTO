import dotenv from 'dotenv';

dotenv.config();

async function checkPortfolioDetail() {
  console.log('📊 포트폴리오 상세 정보\n');
  console.log('='.repeat(80));

  try {
    const { getHoldings, getCashBalance } = await import('../dist/storage/database.js');
    const { getLatestPrices } = await import('../dist/services/realtime-market.js');
    const { getCachedExchangeRate } = await import('../dist/services/exchange.js');

    // 1. 현금 잔고 조회
    const cashUSD = await getCashBalance();
    console.log(`\n💵 현금 잔고: $${cashUSD.toFixed(2)}`);

    // 2. 보유 종목 조회
    const holdings = await getHoldings();
    console.log(`\n📈 보유 종목: ${holdings.length}개\n`);

    if (holdings.length === 0) {
      console.log('⚠️ 보유 종목이 없습니다.\n');
      console.log('='.repeat(80));
      return;
    }

    // 3. 종목 심볼 추출
    const symbols = holdings.map(h => h.symbol);

    // 4. 실시간 가격 조회
    console.log('📡 실시간 가격 조회 중...\n');
    const prices = await getLatestPrices(symbols);

    // 5. 환율 조회
    const exchangeRate = await getCachedExchangeRate();
    const usdToKrw = exchangeRate.usd_to_krw;

    console.log('\n' + '─'.repeat(80));
    console.log('종목    | 수량      | 평균단가  | 현재가    | 평가손익     | 수익률   | 평가금액');
    console.log('─'.repeat(80));

    let totalCost = 0;
    let totalValue = 0;

    for (const holding of holdings) {
      const currentPrice = prices[holding.symbol]?.price || 0;
      const costBasis = holding.avg_cost * holding.shares;
      const marketValue = currentPrice * holding.shares;
      const profitLoss = marketValue - costBasis;
      const profitLossPercent = costBasis > 0 ? (profitLoss / costBasis) * 100 : 0;

      totalCost += costBasis;
      totalValue += marketValue;

      const profitLossStr = profitLoss >= 0
        ? `+$${profitLoss.toFixed(2)}`
        : `-$${Math.abs(profitLoss).toFixed(2)}`;

      const percentStr = profitLossPercent >= 0
        ? `+${profitLossPercent.toFixed(2)}%`
        : `${profitLossPercent.toFixed(2)}%`;

      console.log(
        `${holding.symbol.padEnd(7)} | ` +
        `${holding.shares.toString().padEnd(9)} | ` +
        `$${holding.avg_cost.toFixed(2).padStart(7)} | ` +
        `$${currentPrice.toFixed(2).padStart(7)} | ` +
        `${profitLossStr.padStart(12)} | ` +
        `${percentStr.padStart(8)} | ` +
        `$${marketValue.toFixed(2)}`
      );
    }

    console.log('─'.repeat(80));

    // 6. 총계
    const totalProfitLoss = totalValue - totalCost;
    const totalProfitLossPercent = totalCost > 0 ? (totalProfitLoss / totalCost) * 100 : 0;
    const totalPortfolioUSD = totalValue + cashUSD;
    const totalPortfolioKRW = totalPortfolioUSD * usdToKrw;

    console.log(`\n📊 포트폴리오 요약:`);
    console.log(`   총 투자금액: $${totalCost.toFixed(2)} (₩${(totalCost * usdToKrw).toLocaleString('ko-KR', { maximumFractionDigits: 0 })})`);
    console.log(`   주식 평가액: $${totalValue.toFixed(2)} (₩${(totalValue * usdToKrw).toLocaleString('ko-KR', { maximumFractionDigits: 0 })})`);
    console.log(`   평가손익: ${totalProfitLoss >= 0 ? '+' : ''}$${totalProfitLoss.toFixed(2)} (${totalProfitLossPercent >= 0 ? '+' : ''}${totalProfitLossPercent.toFixed(2)}%)`);
    console.log(`   현금: $${cashUSD.toFixed(2)} (₩${(cashUSD * usdToKrw).toLocaleString('ko-KR', { maximumFractionDigits: 0 })})`);
    console.log(`\n💰 총 포트폴리오 가치: $${totalPortfolioUSD.toFixed(2)} (₩${totalPortfolioKRW.toLocaleString('ko-KR', { maximumFractionDigits: 0 })})`);
    console.log(`   환율: $1 = ₩${usdToKrw.toFixed(2)}`);

    console.log('\n' + '='.repeat(80));

  } catch (error) {
    console.error('\n❌ 포트폴리오 조회 실패:', error);
    console.error('📝 오류 상세:', error.message);
  }
}

checkPortfolioDetail().catch(console.error);
