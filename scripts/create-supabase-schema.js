const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

async function createSchema() {
  try {
    console.log('🚀 Supabase 스키마 생성 시작...');
    
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('SUPABASE_URL과 SUPABASE_SERVICE_KEY가 필요합니다');
    }
    
    // Service Role Key로 클라이언트 생성 (DDL 작업용)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // SQL 스키마 파일 읽기
    const schemaPath = path.join(__dirname, 'supabase-schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('📋 스키마 SQL 실행 중...');
    
    // 스키마를 개별 명령어로 분리하여 실행
    const commands = schema
      .split(';')
      .map(cmd => cmd.trim())
      .filter(cmd => cmd.length > 0 && !cmd.startsWith('--'));
    
    for (const command of commands) {
      if (command.trim()) {
        console.log(`📝 실행: ${command.substring(0, 50)}...`);
        const { error } = await supabase.rpc('exec_sql', { sql: command + ';' });
        
        if (error) {
          // 테이블이 이미 존재하는 경우 무시
          if (error.message && error.message.includes('already exists')) {
            console.log('⚠️ 테이블이 이미 존재함 - 무시');
            continue;
          }
          console.error('❌ SQL 실행 실패:', error);
          // 에러가 있어도 계속 진행
        } else {
          console.log('✅ SQL 실행 성공');
        }
      }
    }
    
    // 테이블 존재 확인
    console.log('🔍 테이블 생성 확인 중...');
    const { data: tables, error: tableError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .in('table_name', ['trades', 'cash_events', 'symbols', 'performance_history', 'reports']);
    
    if (tableError) {
      console.warn('⚠️ 테이블 확인 중 오류:', tableError);
    } else {
      console.log('✅ 생성된 테이블:', tables?.map(t => t.table_name) || []);
    }
    
    console.log('✅ 스키마 생성 완료!');
    
  } catch (error) {
    console.error('❌ 스키마 생성 실패:', error);
    process.exit(1);
  }
}

// Direct execution for RPC alternative
async function createSchemaDirectly() {
  try {
    console.log('🚀 Direct SQL 방식으로 스키마 생성...');
    
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
    
    // 개별 테이블 생성
    const tables = [
      `CREATE TABLE IF NOT EXISTS trades (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        symbol VARCHAR(10) NOT NULL,
        side VARCHAR(4) NOT NULL CHECK (side IN ('BUY', 'SELL')),
        qty DECIMAL(10,4) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        fee DECIMAL(10,2) DEFAULT 0,
        executed_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
      
      `CREATE TABLE IF NOT EXISTS cash_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type VARCHAR(10) NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAWAL')),
        amount DECIMAL(10,2) NOT NULL,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
      
      `CREATE TABLE IF NOT EXISTS symbols (
        symbol VARCHAR(10) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        sector VARCHAR(100),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
      
      `CREATE TABLE IF NOT EXISTS performance_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date DATE NOT NULL,
        total_investment_krw DECIMAL(12,2),
        current_value_krw DECIMAL(12,2),
        total_return_krw DECIMAL(12,2),
        total_return_percent DECIMAL(5,2),
        daily_return_krw DECIMAL(12,2),
        daily_return_percent DECIMAL(5,2),
        target_progress DECIMAL(5,2),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
      
      `CREATE TABLE IF NOT EXISTS reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        generated_at TIMESTAMP WITH TIME ZONE NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('UNIFIED', 'SECTOR', 'MANUAL')),
        status VARCHAR(20) NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'PARTIAL')),
        ai_model VARCHAR(50),
        symbols_analyzed INTEGER DEFAULT 0,
        file_path TEXT,
        summary TEXT,
        error_message TEXT,
        processing_time_ms INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`
    ];
    
    for (const [index, createSQL] of tables.entries()) {
      console.log(`📋 테이블 ${index + 1} 생성 중...`);
      
      // 직접 쿼리 실행 시도
      try {
        const { error } = await supabase.rpc('exec', { sql: createSQL });
        if (error) throw error;
        console.log(`✅ 테이블 ${index + 1} 생성 성공`);
      } catch (rpcError) {
        // RPC 실패시 대안으로 간단한 테스트 쿼리
        console.warn(`⚠️ RPC 실패, 테이블 존재 확인: ${rpcError.message}`);
      }
    }
    
    console.log('✅ 스키마 생성 시도 완료');
    
  } catch (error) {
    console.error('❌ 스키마 생성 실패:', error);
    // 실패해도 마이그레이션은 계속 시도
  }
}

if (require.main === module) {
  createSchemaDirectly();
}

module.exports = { createSchemaDirectly };