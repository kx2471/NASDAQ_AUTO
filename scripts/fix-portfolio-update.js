const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const today = new Date().toISOString().split('T')[0];

async function fixPortfolioUpdate() {
  try {
    console.log('🔧 포트폴리오 업데이트 수정 시작...');
    
    // 1. 현금 이벤트를 DEPOSIT으로 수정하여 추가
    console.log('💰 현금 잔고 수정 중...');
    const finalCashBalance = 13 / 1300; // $0.01
    
    const { error: cashError } = await supabase
      .from('cash_events')
      .insert({
        type: 'DEPOSIT', // ADJUSTMENT 대신 DEPOSIT 사용
        amount: finalCashBalance,
        description: `포트폴리오 재구성 후 최종 현금 잔고: $${finalCashBalance.toFixed(2)}`
      });
    
    if (cashError) {
      console.error('❌ 현금 잔고 수정 실패:', cashError);
    } else {
      console.log(`✅ 현금 잔고 수정 완료: $${finalCashBalance.toFixed(2)}`);
    }
    
    // 2. 기존 성과 기록을 업데이트 (upsert 대신 update)
    console.log('📊 성과 기록 업데이트 중...');
    const totalValue = 1715.19;
    const exchangeRate = 1300;
    const totalValueKRW = totalValue * exchangeRate;
    
    const { error: perfError } = await supabase
      .from('performance_history')
      .update({
        current_value_krw: totalValueKRW,
        total_return_krw: totalValueKRW - 2400000,
        total_return_percent: ((totalValueKRW - 2400000) / 2400000) * 100,
        target_progress: (totalValueKRW / 10000000) * 100,
        portfolio_value_usd: totalValue
      })
      .eq('date', today);
    
    if (perfError) {
      console.error('❌ 성과 기록 업데이트 실패:', perfError);
    } else {
      console.log('✅ 성과 기록 업데이트 완료');
    }
    
    // 3. 현재 포트폴리오 상태 확인
    console.log('🔍 현재 포트폴리오 상태 확인 중...');
    
    const { data: trades, error: tradesError } = await supabase
      .from('trades')
      .select('*')
      .order('executed_at', { ascending: false })
      .limit(10);
    
    if (tradesError) {
      console.error('❌ 거래 내역 조회 실패:', tradesError);
    } else {
      console.log('📊 최근 거래 내역:');
      trades.forEach(trade => {
        console.log(`  ${trade.executed_at.split('T')[0]} ${trade.side} ${trade.symbol}: ${trade.qty}주 @ $${trade.price}`);
      });
    }
    
    // 4. 현재 보유 종목 계산
    const { data: allTrades, error: allTradesError } = await supabase
      .from('trades')
      .select('*')
      .order('executed_at', { ascending: true });
    
    if (!allTradesError && allTrades) {
      const holdings = {};
      
      allTrades.forEach(trade => {
        if (!holdings[trade.symbol]) {
          holdings[trade.symbol] = { qty: 0, totalCost: 0 };
        }
        
        if (trade.side === 'BUY') {
          holdings[trade.symbol].qty += parseFloat(trade.qty);
          holdings[trade.symbol].totalCost += parseFloat(trade.qty) * parseFloat(trade.price);
        } else if (trade.side === 'SELL') {
          holdings[trade.symbol].qty -= parseFloat(trade.qty);
        }
      });
      
      console.log('\n📈 현재 보유 종목:');
      Object.entries(holdings).forEach(([symbol, data]) => {
        if (data.qty > 0) {
          const avgPrice = data.totalCost / data.qty;
          console.log(`  ${symbol}: ${data.qty.toFixed(6)}주 (평균단가: $${avgPrice.toFixed(2)})`);
        }
      });
    }
    
    console.log('\n✅ 포트폴리오 업데이트 수정 완료!');
    
  } catch (error) {
    console.error('❌ 수정 작업 실패:', error);
  }
}

if (require.main === module) {
  fixPortfolioUpdate();
}

module.exports = { fixPortfolioUpdate };