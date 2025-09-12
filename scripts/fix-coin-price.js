const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function fixCoinPrice() {
  try {
    console.log('🔧 COIN 평단가 수정 시작...');
    
    // 기존 COIN 매수 거래를 325.93으로 수정
    const { error: updateError } = await supabase
      .from('trades')
      .update({ price: 325.93 })
      .eq('symbol', 'COIN')
      .eq('side', 'BUY');
    
    if (updateError) {
      console.error('❌ COIN 가격 수정 실패:', updateError);
    } else {
      console.log('✅ COIN 평단가 수정 완료: $325.93');
    }
    
    // 현재 거래 내역 확인
    const { data: trades, error: fetchError } = await supabase
      .from('trades')
      .select('*')
      .eq('symbol', 'COIN')
      .order('executed_at', { ascending: false });
    
    if (fetchError) {
      console.error('❌ 거래 내역 조회 실패:', fetchError);
    } else {
      console.log('📊 COIN 거래 내역:');
      trades.forEach(trade => {
        console.log(`  ${trade.executed_at.split('T')[0]} ${trade.side} ${trade.qty}주 @ $${trade.price}`);
      });
    }
    
    console.log('✅ COIN 평단가 수정 완료!');
    
  } catch (error) {
    console.error('❌ 수정 작업 실패:', error);
  }
}

if (require.main === module) {
  fixCoinPrice();
}

module.exports = { fixCoinPrice };