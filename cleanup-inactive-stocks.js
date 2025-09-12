/**
 * 비활성 종목 정리 스크립트
 * symbols.json에서 데이터 품질이 낮은 종목들을 식별하고 비활성화합니다.
 */

const fs = require('fs').promises;
const path = require('path');
const { filterHighQualityStocks, validateStockDataQuality, fetchDailyPrices } = require('./dist/services/market');

async function cleanupInactiveStocks() {
  try {
    console.log('🔍 비활성 종목 정리 시작...');
    
    // 1. 현재 symbols.json 로드
    const symbolsPath = path.join(__dirname, 'data/json/symbols.json');
    const symbolsData = JSON.parse(await fs.readFile(symbolsPath, 'utf8'));
    
    console.log(`📊 총 ${symbolsData.length}개 종목 검사 시작`);
    
    // 2. 각 종목의 데이터 품질 검증
    const results = {
      active: [],
      inactive: [],
      errors: []
    };
    
    for (let i = 0; i < symbolsData.length; i++) {
      const stock = symbolsData[i];
      console.log(`\n검사 중 (${i + 1}/${symbolsData.length}): ${stock.symbol} - ${stock.name}`);
      
      try {
        // 가격 데이터 조회
        const priceData = await fetchDailyPrices([stock.symbol]);
        const stockPrices = priceData[stock.symbol] || [];
        
        // 데이터 품질 검증
        const quality = await validateStockDataQuality(stock.symbol, stockPrices);
        
        // 결과에 따라 분류
        if (quality.isActive && quality.hasMinimumData) {
          results.active.push({
            ...stock,
            quality: quality
          });
          console.log(`✅ ${stock.symbol}: 활성 종목 (거래량: ${quality.avgVolume?.toLocaleString() || 'N/A'}, 시가총액: $${(quality.marketCap || 0).toLocaleString()})`);
        } else {
          results.inactive.push({
            ...stock,
            active: false, // 비활성화
            quality: quality,
            inactiveReason: [
              !quality.isActive ? '거래량/가격 부족' : '',
              !quality.hasMinimumData ? '데이터 부족' : ''
            ].filter(r => r).join(', ')
          });
          console.log(`❌ ${stock.symbol}: 비활성 종목 (이유: ${!quality.isActive ? '거래량/가격 부족' : ''}${!quality.hasMinimumData ? ' 데이터 부족' : ''})`);
        }
        
        // API 제한 준수를 위한 딜레이
        if (i < symbolsData.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (error) {
        console.error(`⚠️ ${stock.symbol} 검사 실패:`, error.message);
        results.errors.push({
          ...stock,
          error: error.message
        });
      }
    }
    
    // 3. 결과 요약
    console.log('\n\n📊 정리 결과 요약:');
    console.log(`✅ 활성 종목: ${results.active.length}개`);
    console.log(`❌ 비활성 종목: ${results.inactive.length}개`);
    console.log(`⚠️ 오류 종목: ${results.errors.length}개`);
    
    // 4. 업데이트된 symbols.json 생성
    const updatedSymbols = [
      ...results.active,
      ...results.inactive.map(stock => ({
        symbol: stock.symbol,
        name: stock.name,
        exchange: stock.exchange,
        sector: stock.sector,
        industry: stock.industry,
        active: false, // 비활성화
        lastChecked: new Date().toISOString(),
        inactiveReason: stock.inactiveReason
      })),
      ...results.errors.map(stock => ({
        ...stock,
        lastChecked: new Date().toISOString(),
        checkError: stock.error
      }))
    ];
    
    // 5. 백업 생성
    const backupPath = path.join(__dirname, `data/json/symbols_backup_${Date.now()}.json`);
    await fs.writeFile(backupPath, JSON.stringify(symbolsData, null, 2));
    console.log(`💾 기존 데이터 백업: ${backupPath}`);
    
    // 6. 새로운 symbols.json 저장
    await fs.writeFile(symbolsPath, JSON.stringify(updatedSymbols, null, 2));
    console.log(`✅ 업데이트된 symbols.json 저장 완료`);
    
    // 7. 상세 보고서 생성
    const reportPath = path.join(__dirname, `data/report/stock_cleanup_report_${Date.now()}.json`);
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total: symbolsData.length,
        active: results.active.length,
        inactive: results.inactive.length,
        errors: results.errors.length
      },
      details: {
        active: results.active,
        inactive: results.inactive,
        errors: results.errors
      }
    };
    
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`📄 상세 보고서 생성: ${reportPath}`);
    
    console.log('\n🎉 비활성 종목 정리 완료!');
    
  } catch (error) {
    console.error('❌ 비활성 종목 정리 실패:', error);
    process.exit(1);
  }
}

// 스크립트 실행
if (require.main === module) {
  cleanupInactiveStocks();
}

module.exports = { cleanupInactiveStocks };