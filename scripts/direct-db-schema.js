const { Pool } = require('pg');
require('dotenv').config();

// Supabase PostgreSQL 연결 정보 추출
function getDbConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  
  // Supabase URL에서 PostgreSQL 연결 정보 추출
  // https://olhzmjjshyevczsiykia.supabase.co -> olhzmjjshyevczsiykia
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
  
  return {
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: serviceKey, // Service key as password
    ssl: {
      rejectUnauthorized: false
    }
  };
}

async function addMissingColumnsDirectly() {
  const pool = new Pool(getDbConfig());
  
  try {
    console.log('🔗 PostgreSQL 직접 연결 중...');
    
    const client = await pool.connect();
    console.log('✅ PostgreSQL 연결 성공');
    
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
    
    console.log('🔧 스키마 변경 중...');
    
    for (const sql of alterStatements) {
      try {
        console.log(`📝 실행: ${sql.substring(0, 50)}...`);
        await client.query(sql);
        console.log('✅ 실행 성공');
      } catch (sqlError) {
        if (sqlError.message.includes('already exists')) {
          console.log('⚠️ 컬럼이 이미 존재함 - 무시');
        } else {
          console.error(`❌ SQL 실행 실패: ${sqlError.message}`);
        }
      }
    }
    
    // 테이블 구조 확인
    console.log('🔍 테이블 구조 확인 중...');
    
    const symbolsColumns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'symbols' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    console.log('📊 symbols 테이블 컬럼:');
    symbolsColumns.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
    
    const perfColumns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'performance_history' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    console.log('📈 performance_history 테이블 컬럼:');
    perfColumns.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
    
    client.release();
    console.log('✅ 스키마 업데이트 완료!');
    
    // 다시 마이그레이션 테스트
    console.log('🔄 마이그레이션 재시도...');
    
    return true;
    
  } catch (error) {
    console.error('❌ PostgreSQL 연결 실패:', error.message);
    
    if (error.message.includes('password')) {
      console.log('💡 Service Key를 PostgreSQL 비밀번호로 사용하려고 했지만 실패했습니다.');
      console.log('🔧 대신 Supabase 대시보드에서 수동으로 SQL을 실행해주세요:');
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
    
    return false;
    
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  addMissingColumnsDirectly();
}

module.exports = { addMissingColumnsDirectly };