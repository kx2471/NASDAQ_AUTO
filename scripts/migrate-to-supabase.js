require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');

/**
 * JSON 데이터를 Supabase PostgreSQL로 마이그레이션하는 스크립트
 * DB_Mig.md 지시사항에 따라 구현
 */

const { 
  supabase, 
  testSupabaseConnection,
  addTrade,
  addCashEvent,
  upsertSymbol,
  addPerformanceHistory
} = require('../dist/services/supabase');

async function migrateData() {
  console.log('🚀 Supabase 데이터 마이그레이션 시작...');
  
  // 1. Supabase 연결 테스트
  console.log('🔗 Supabase 연결 테스트 중...');
  const isConnected = await testSupabaseConnection();
  if (!isConnected) {
    console.error('❌ Supabase 연결 실패. 환경변수를 확인하세요.');
    process.exit(1);
  }
  
  const dataDir = path.join(__dirname, '..', 'data', 'json');
  const backupDir = path.join(__dirname, '..', 'data', 'json-backup');
  
  // 2. JSON 파일 백업 (안전을 위해)
  if (process.env.BACKUP_JSON_FILES === 'true') {
    console.log('💾 JSON 파일 백업 중...');
    try {
      await fs.mkdir(backupDir, { recursive: true });
      const files = await fs.readdir(dataDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const source = path.join(dataDir, file);
          const dest = path.join(backupDir, `${file}.backup-${Date.now()}`);
          await fs.copyFile(source, dest);
          console.log(`✅ ${file} 백업 완료`);
        }
      }
    } catch (error) {
      console.error('❌ 백업 실패:', error);
      process.exit(1);
    }
  }
  
  let migratedCounts = {
    trades: 0,
    cash_events: 0,
    symbols: 0,
    performance_history: 0
  };
  
  try {
    // 3. trades.json → trades 테이블 마이그레이션
    console.log('📈 거래 기록 마이그레이션 중...');
    try {
      const tradesPath = path.join(dataDir, 'trades.json');
      const tradesData = JSON.parse(await fs.readFile(tradesPath, 'utf8'));
      
      for (const trade of tradesData) {
        try {
          // JSON 구조를 Supabase 스키마에 맞게 변환
          const supabaseTrade = {
            symbol: trade.symbol,
            side: trade.side,
            qty: parseFloat(trade.qty),
            price: parseFloat(trade.price),
            fee: parseFloat(trade.fee || 0),
            executed_at: trade.traded_at || trade.executed_at || new Date().toISOString()
          };
          
          await addTrade(supabaseTrade);
          migratedCounts.trades++;
        } catch (tradeError) {
          console.warn(`⚠️ 거래 기록 마이그레이션 실패 (${trade.symbol}):`, tradeError.message);
        }
      }
      console.log(`✅ ${migratedCounts.trades}개 거래 기록 마이그레이션 완료`);
    } catch (error) {
      console.warn('⚠️ trades.json 파일이 없거나 읽을 수 없습니다:', error.message);
    }
    
    // 4. cash_events.json → cash_events 테이블 마이그레이션
    console.log('💰 현금 이벤트 마이그레이션 중...');
    try {
      const cashEventsPath = path.join(dataDir, 'cash_events.json');
      const cashEventsData = JSON.parse(await fs.readFile(cashEventsPath, 'utf8'));
      
      for (const event of cashEventsData) {
        try {
          const supabaseCashEvent = {
            type: event.type,
            amount: parseFloat(event.amount),
            description: event.note || event.description || ''
          };
          
          await addCashEvent(supabaseCashEvent);
          migratedCounts.cash_events++;
        } catch (eventError) {
          console.warn(`⚠️ 현금 이벤트 마이그레이션 실패:`, eventError.message);
        }
      }
      console.log(`✅ ${migratedCounts.cash_events}개 현금 이벤트 마이그레이션 완료`);
    } catch (error) {
      console.warn('⚠️ cash_events.json 파일이 없거나 읽을 수 없습니다:', error.message);
    }
    
    // 5. symbols.json → symbols 테이블 마이그레이션
    console.log('📊 종목 데이터 마이그레이션 중...');
    try {
      const symbolsPath = path.join(dataDir, 'symbols.json');
      const symbolsData = JSON.parse(await fs.readFile(symbolsPath, 'utf8'));
      
      for (const symbol of symbolsData) {
        try {
          const supabaseSymbol = {
            symbol: symbol.symbol,
            name: symbol.name,
            exchange: symbol.exchange,
            sector: symbol.sector,
            industry: symbol.industry,
            active: symbol.active !== false,
            avg_volume: symbol.quality?.avgVolume || null,
            market_cap: symbol.quality?.marketCap || null,
            is_active: symbol.quality?.isActive !== false,
            has_minimum_data: symbol.quality?.hasMinimumData !== false
          };
          
          await upsertSymbol(supabaseSymbol);
          migratedCounts.symbols++;
        } catch (symbolError) {
          console.warn(`⚠️ 종목 마이그레이션 실패 (${symbol.symbol}):`, symbolError.message);
        }
      }
      console.log(`✅ ${migratedCounts.symbols}개 종목 마이그레이션 완료`);
    } catch (error) {
      console.warn('⚠️ symbols.json 파일이 없거나 읽을 수 없습니다:', error.message);
    }
    
    // 6. performance_history.json → performance_history 테이블 마이그레이션
    console.log('📈 성과 기록 마이그레이션 중...');
    try {
      const performancePath = path.join(dataDir, 'performance_history.json');
      const performanceData = JSON.parse(await fs.readFile(performancePath, 'utf8'));
      
      for (const record of performanceData) {
        try {
          const supabasePerformance = {
            date: record.date,
            total_investment_krw: parseFloat(record.total_investment_krw),
            current_value_krw: parseFloat(record.current_value_krw),
            total_return_krw: parseFloat(record.total_return_krw),
            total_return_percent: parseFloat(record.total_return_percent),
            target_progress: parseFloat(record.target_progress),
            exchange_rate: parseFloat(record.exchange_rate || 0)
          };
          
          await addPerformanceHistory(supabasePerformance);
          migratedCounts.performance_history++;
        } catch (perfError) {
          console.warn(`⚠️ 성과 기록 마이그레이션 실패 (${record.date}):`, perfError.message);
        }
      }
      console.log(`✅ ${migratedCounts.performance_history}개 성과 기록 마이그레이션 완료`);
    } catch (error) {
      console.warn('⚠️ performance_history.json 파일이 없거나 읽을 수 없습니다:', error.message);
    }
    
    // 7. 마이그레이션 결과 출력
    console.log('\n🎉 데이터 마이그레이션 완료!');
    console.log('📊 마이그레이션 결과:');
    console.log(`  - 거래 기록: ${migratedCounts.trades}개`);
    console.log(`  - 현금 이벤트: ${migratedCounts.cash_events}개`);
    console.log(`  - 종목 데이터: ${migratedCounts.symbols}개`);
    console.log(`  - 성과 기록: ${migratedCounts.performance_history}개`);
    
    // 8. 데이터 무결성 검증
    console.log('\n🔍 데이터 무결성 검증 중...');
    await verifyDataIntegrity();
    
  } catch (error) {
    console.error('❌ 마이그레이션 중 오류 발생:', error);
    process.exit(1);
  }
}

/**
 * 데이터 무결성 검증 함수
 */
async function verifyDataIntegrity() {
  try {
    const { getHoldings, getCashBalance } = require('../dist/services/supabase');
    
    // 보유 종목 검증
    const holdings = await getHoldings();
    console.log(`✅ 현재 보유 종목: ${holdings.length}개`);
    holdings.forEach(holding => {
      console.log(`  - ${holding.symbol}: ${holding.shares}주 (평균 단가: $${holding.avg_cost.toFixed(2)})`);
    });
    
    // 현금 잔액 검증
    const cashBalance = await getCashBalance();
    console.log(`✅ 현재 현금 잔액: $${cashBalance.toFixed(2)}`);
    
    // 총 투자 가치 계산
    const totalInvestment = holdings.reduce((sum, h) => sum + (h.shares * h.avg_cost), 0);
    const totalValue = totalInvestment + cashBalance;
    console.log(`✅ 총 포트폴리오 가치: $${totalValue.toFixed(2)}`);
    
  } catch (error) {
    console.error('❌ 데이터 검증 실패:', error);
  }
}

// 스크립트 실행
if (require.main === module) {
  migrateData()
    .then(() => {
      console.log('✅ 마이그레이션 스크립트 완료');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 마이그레이션 스크립트 실패:', error);
      process.exit(1);
    });
}

module.exports = { migrateData, verifyDataIntegrity };