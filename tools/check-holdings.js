/**
 * 보유 종목 리스트 확인
 */

require('dotenv').config();

async function main() {
  console.log('📋 보유 종목 확인\n');

  try {
    const { getHoldings } = require('../dist/storage/database');

    const holdings = await getHoldings();

    console.log(`✅ 보유 종목: ${holdings.length}개\n`);

    for (const holding of holdings) {
      console.log(`${holding.symbol}: ${holding.shares}주 (평균 단가: $${holding.avg_cost.toFixed(2)})`);
    }

  } catch (error) {
    console.error('❌ 오류:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
