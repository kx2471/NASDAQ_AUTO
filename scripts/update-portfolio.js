const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');

require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// 오늘 날짜
const today = new Date().toISOString().split('T')[0];

async function updatePortfolio() {
  try {
    console.log('🔄 포트폴리오 업데이트 시작...');
    
    // 1. TSLA 전량매도 거래 추가 (기존 13.8336주)
    console.log('📊 TSLA 전량매도 거래 추가...');
    const tslaQuantity = 13.8336;
    const tslaAvgPrice = 318.02;
    const tslaSellPrice = 400; // 추정 매도가
    
    const { error: tslaSellError } = await supabase
      .from('trades')
      .insert({
        symbol: 'TSLA',
        side: 'SELL',
        qty: tslaQuantity,
        price: tslaSellPrice,
        fee: 0,
        executed_at: new Date().toISOString()
      });
    
    if (tslaSellError) {
      console.error('❌ TSLA 매도 거래 추가 실패:', tslaSellError);
    } else {
      console.log('✅ TSLA 전량매도 거래 추가 완료');
    }
    
    // 2. PL 전량매도 거래 추가 (기존 93주)
    console.log('📊 PL 전량매도 거래 추가...');
    const plQuantity = 93;
    const plAvgPrice = 6.94;
    const plSellPrice = 9; // 추정 매도가
    
    const { error: plSellError } = await supabase
      .from('trades')
      .insert({
        symbol: 'PL',
        side: 'SELL',
        qty: plQuantity,
        price: plSellPrice,
        fee: 0,
        executed_at: new Date().toISOString()
      });
    
    if (plSellError) {
      console.error('❌ PL 매도 거래 추가 실패:', plSellError);
    } else {
      console.log('✅ PL 전량매도 거래 추가 완료');
    }
    
    // 3. 새로운 매수 거래들 추가
    const newTrades = [
      { symbol: 'BABA', side: 'BUY', qty: 1, price: 154.40, fee: 0 },
      { symbol: 'GOOGL', side: 'BUY', qty: 4.866031, price: 240.46, fee: 0 },
      { symbol: 'NVDA', side: 'BUY', qty: 2, price: 177.38, fee: 0 },
      { symbol: 'COIN', side: 'BUY', qty: 1, price: 35.93, fee: 0 }
    ];
    
    console.log('📊 신규 매수 거래 추가 중...');
    for (const trade of newTrades) {
      const { error } = await supabase
        .from('trades')
        .insert({
          ...trade,
          executed_at: new Date().toISOString()
        });
      
      if (error) {
        console.error(`❌ ${trade.symbol} 매수 거래 추가 실패:`, error);
      } else {
        console.log(`✅ ${trade.symbol} 매수 거래 추가 완료: ${trade.qty}주 @ $${trade.price}`);
      }
    }
    
    // 4. 현금 잔고 업데이트 (매도 수익 반영)
    console.log('💰 현금 잔고 업데이트 중...');
    const finalCashBalance = 13 / 1300; // $13 (원화) → USD
    
    const { error: cashError } = await supabase
      .from('cash_events')
      .insert({
        type: 'ADJUSTMENT',
        amount: finalCashBalance,
        description: `포트폴리오 재구성 후 최종 현금 잔고: $${finalCashBalance.toFixed(2)}`,
        created_at: new Date().toISOString()
      });
    
    if (cashError) {
      console.error('❌ 현금 잔고 업데이트 실패:', cashError);
    } else {
      console.log(`✅ 현금 잔고 업데이트 완료: $${finalCashBalance.toFixed(2)}`);
    }
    
    // 5. 현재 포트폴리오 가치 계산
    console.log('📈 현재 포트폴리오 가치 계산 중...');
    const currentPositions = [
      { symbol: 'BABA', qty: 1, price: 154.40 },
      { symbol: 'GOOGL', qty: 4.866031, price: 240.46 },
      { symbol: 'NVDA', qty: 2, price: 177.38 },
      { symbol: 'COIN', qty: 1, price: 35.93 }
    ];
    
    let totalValue = 0;
    currentPositions.forEach(pos => {
      totalValue += pos.qty * pos.price;
      console.log(`  ${pos.symbol}: ${pos.qty}주 × $${pos.price} = $${(pos.qty * pos.price).toFixed(2)}`);
    });
    
    totalValue += finalCashBalance;
    console.log(`💰 총 포트폴리오 가치: $${totalValue.toFixed(2)}`);
    
    // 6. 성과 기록 업데이트
    console.log('📊 성과 기록 업데이트 중...');
    const exchangeRate = 1300; // KRW/USD
    const totalValueKRW = totalValue * exchangeRate;
    
    const { error: perfError } = await supabase
      .from('performance_history')
      .upsert({
        date: today,
        total_investment_krw: 2400000, // 추정 총 투자금액
        current_value_krw: totalValueKRW,
        total_return_krw: totalValueKRW - 2400000,
        total_return_percent: ((totalValueKRW - 2400000) / 2400000) * 100,
        daily_return_krw: 0,
        daily_return_percent: 0,
        target_progress: (totalValueKRW / 10000000) * 100, // 1000만원 목표 기준
        exchange_rate: exchangeRate,
        portfolio_value_usd: totalValue
      });
    
    if (perfError) {
      console.error('❌ 성과 기록 업데이트 실패:', perfError);
    } else {
      console.log('✅ 성과 기록 업데이트 완료');
    }
    
    // 7. JSON 파일도 업데이트 (백업용)
    console.log('💾 JSON 파일 백업 업데이트 중...');
    
    // trades.json 읽기
    const tradesPath = path.join(__dirname, '..', 'data', 'json', 'trades.json');
    let trades = [];
    try {
      const tradesData = await fs.readFile(tradesPath, 'utf8');
      trades = JSON.parse(tradesData);
    } catch (error) {
      console.log('새로운 trades.json 생성');
    }
    
    // 새 거래들 추가
    const allNewTrades = [
      {
        symbol: 'TSLA',
        side: 'SELL',
        qty: tslaQuantity,
        price: tslaSellPrice,
        fee: 0,
        executed_at: new Date().toISOString()
      },
      {
        symbol: 'PL',
        side: 'SELL', 
        qty: plQuantity,
        price: plSellPrice,
        fee: 0,
        executed_at: new Date().toISOString()
      },
      ...newTrades.map(trade => ({
        ...trade,
        executed_at: new Date().toISOString()
      }))
    ];
    
    trades.push(...allNewTrades);
    await fs.writeFile(tradesPath, JSON.stringify(trades, null, 2));
    console.log('✅ trades.json 백업 완료');
    
    console.log('\n🎉 포트폴리오 업데이트 완료!');
    console.log('📊 새로운 포트폴리오 구성:');
    console.log('  - BABA: 1주 @ $154.40');
    console.log('  - GOOGL: 4.866031주 @ $240.46');
    console.log('  - NVDA: 2주 @ $177.38');
    console.log('  - COIN: 1주 @ $35.93');
    console.log(`  - 현금: $${finalCashBalance.toFixed(2)}`);
    console.log(`💰 총 가치: $${totalValue.toFixed(2)} (₩${totalValueKRW.toLocaleString()})`);
    
  } catch (error) {
    console.error('❌ 포트폴리오 업데이트 실패:', error);
  }
}

if (require.main === module) {
  updatePortfolio();
}

module.exports = { updatePortfolio };