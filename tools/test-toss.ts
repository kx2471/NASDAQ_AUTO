import dotenv from 'dotenv';
dotenv.config();

import {
  isTossEnabled,
  getAccessToken,
  tossRequest,
  getPrices,
  getExchangeRate,
  getHoldings,
  getBuyingPower,
  createOrder,
  isDryRun
} from '../src/services/toss';

/**
 * 토스증권 Open API 통합 점검 스크립트
 * 실행: npx tsx tools/test-toss.ts
 *
 * 토큰 발급 → 계좌 → 시세 → 보유 → 매수가능 → 환율 → dry-run 주문 순으로 점검한다.
 * (createOrder는 TOSS_DRY_RUN 기본값 때문에 실제 주문을 전송하지 않는다.)
 */
async function main() {
  console.log('🔎 토스 자격증명:', isTossEnabled() ? 'OK' : '없음');
  console.log('🔎 DRY-RUN 모드:', isDryRun());
  if (!isTossEnabled()) {
    console.error('TOSS_API_KEY / TOSS_SECRET_KEY를 .env에 설정하세요.');
    process.exit(1);
  }

  // 1. 토큰 발급
  await getAccessToken();

  // 2. 계좌 목록
  const accounts = await tossRequest<Array<{ accountNo: string; accountSeq: number; accountType: string }>>(
    'get', '/api/v1/accounts'
  );
  console.log('🏦 계좌:', accounts.map(a => `${a.accountNo}(${a.accountType},seq=${a.accountSeq})`).join(', '));

  // 3. 보유 종목
  const holdings = await getHoldings();
  console.log(`📦 보유종목 ${holdings.length}개:`);
  holdings.forEach(h => console.log(`   ${h.symbol}: ${h.shares}주 @ $${h.avg_cost} (현재 $${h.lastPrice})`));

  // 4. 보유 종목 현재가
  const symbols = holdings.map(h => h.symbol);
  if (symbols.length > 0) {
    const prices = await getPrices(symbols);
    console.log('💰 현재가:', JSON.stringify(prices));
  }

  // 5. 매수 가능 금액
  const buyingPower = await getBuyingPower('USD');
  console.log(`💵 USD 매수가능금액: $${buyingPower}`);

  // 6. 환율
  const rate = await getExchangeRate('USD', 'KRW');
  console.log(`💱 USD/KRW: ${rate}`);

  // 7. dry-run 주문 (실제 전송 안 됨)
  const dryOrder = await createOrder({
    symbol: symbols[0] || 'AAPL',
    side: 'BUY',
    orderType: 'LIMIT',
    quantity: 1,
    price: 1,
    clientOrderId: 'test-dryrun-001'
  });
  console.log('🧪 dry-run 주문 결과:', JSON.stringify(dryOrder));

  console.log('\n✅ 토스 통합 점검 완료');
}

main().catch(err => {
  console.error('❌ 점검 실패:', err);
  process.exit(1);
});
