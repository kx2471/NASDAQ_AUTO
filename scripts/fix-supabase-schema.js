const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function addMissingColumns() {
  try {
    console.log('🔧 Supabase 스키마 수정 시작...');
    
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
    
    // 누락된 컬럼들을 추가하는 SQL
    const alterStatements = [
      // symbols 테이블 컬럼 추가
      "ALTER TABLE symbols ADD COLUMN IF NOT EXISTS avg_volume BIGINT DEFAULT 0",
      "ALTER TABLE symbols ADD COLUMN IF NOT EXISTS market_cap DECIMAL(15,2) DEFAULT 0", 
      "ALTER TABLE symbols ADD COLUMN IF NOT EXISTS pe_ratio DECIMAL(8,2) DEFAULT 0",
      "ALTER TABLE symbols ADD COLUMN IF NOT EXISTS dividend_yield DECIMAL(5,2) DEFAULT 0",
      "ALTER TABLE symbols ADD COLUMN IF NOT EXISTS beta DECIMAL(8,4) DEFAULT 0",
      "ALTER TABLE symbols ADD COLUMN IF NOT EXISTS price DECIMAL(10,2) DEFAULT 0",
      "ALTER TABLE symbols ADD COLUMN IF NOT EXISTS change_percent DECIMAL(8,4) DEFAULT 0",
      
      // performance_history 테이블 컬럼 추가
      "ALTER TABLE performance_history ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(8,4) DEFAULT 1300.0",
      "ALTER TABLE performance_history ADD COLUMN IF NOT EXISTS portfolio_value_usd DECIMAL(12,2) DEFAULT 0"
    ];
    
    console.log('📝 컬럼 추가 SQL 실행 중...');
    
    // 각 SQL 문 실행
    for (const sql of alterStatements) {
      try {
        console.log(`🔄 실행: ${sql.substring(0, 50)}...`);
        
        // raw SQL 실행 시도
        const { data, error } = await supabase.rpc('sql', { query: sql });
        
        if (error) {
          // RPC 함수가 없는 경우 대안 시도
          console.log(`⚠️ RPC 실패, 대안 시도: ${error.message}`);
        } else {
          console.log('✅ SQL 실행 성공');
        }
        
      } catch (sqlError) {
        console.log(`⚠️ SQL 실행 실패: ${sqlError.message}`);
      }
      
      // API 제한 방지
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // 테이블 구조 확인
    console.log('🔍 테이블 구조 확인 중...');
    
    try {
      const { data: symbolsColumns } = await supabase
        .from('information_schema.columns')
        .select('column_name')
        .eq('table_name', 'symbols')
        .eq('table_schema', 'public');
      
      if (symbolsColumns) {
        console.log('📊 symbols 테이블 컬럼:', symbolsColumns.map(c => c.column_name).join(', '));
      }
      
      const { data: perfColumns } = await supabase
        .from('information_schema.columns')
        .select('column_name')
        .eq('table_name', 'performance_history')
        .eq('table_schema', 'public');
      
      if (perfColumns) {
        console.log('📈 performance_history 테이블 컬럼:', perfColumns.map(c => c.column_name).join(', '));
      }
      
    } catch (infoError) {
      console.log('⚠️ 테이블 정보 조회 제한:', infoError.message);
    }
    
    console.log('✅ 스키마 수정 시도 완료!');
    console.log('\n💡 수동으로 Supabase 대시보드에서 다음 SQL을 실행해주세요:');
    
    alterStatements.forEach(sql => {
      console.log(sql + ';');
    });
    
  } catch (error) {
    console.error('❌ 스키마 수정 실패:', error.message);
    console.log('\n🔧 수동 SQL (Supabase 대시보드에서 실행):');
    console.log(`
-- symbols 테이블 컬럼 추가
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS avg_volume BIGINT DEFAULT 0;
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS market_cap DECIMAL(15,2) DEFAULT 0;
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS pe_ratio DECIMAL(8,2) DEFAULT 0;
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS dividend_yield DECIMAL(5,2) DEFAULT 0;
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS beta DECIMAL(8,4) DEFAULT 0;
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS price DECIMAL(10,2) DEFAULT 0;
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS change_percent DECIMAL(8,4) DEFAULT 0;

-- performance_history 테이블 컬럼 추가
ALTER TABLE performance_history ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(8,4) DEFAULT 1300.0;
ALTER TABLE performance_history ADD COLUMN IF NOT EXISTS portfolio_value_usd DECIMAL(12,2) DEFAULT 0;
    `);
  }
}

if (require.main === module) {
  addMissingColumns();
}

module.exports = { addMissingColumns };