require('dotenv').config();
const { ScreeningService } = require('./dist/services/screening');

async function testDiverseScreening() {
  console.log('🔍 다양한 종목 스크리닝 테스트...');
  
  const screening = new ScreeningService();
  
  try {
    // 각 섹터별로 스크리닝 실행
    const sectors = ['ai', 'computing', 'nuclear'];
    
    for (const sector of sectors) {
      console.log(`\n📊 ${sector} 섹터 스크리닝 중...`);
      
      const results = await screening.screenSector(sector, {
        days: 1,
        include_news: true,
        indicators: true,
        limit: 20,
        min_volume: 500000,
        min_market_cap: 100000000
      });
      
      console.log(`✅ ${sector} 섹터: ${results.screened_stocks.length}개 종목 스크리닝됨`);
      
      // 처음 5개 종목 심볼 출력
      const symbols = results.screened_stocks.slice(0, 10).map(s => s.symbol);
      console.log(`🎯 상위 종목들: ${symbols.join(', ')}`);
    }
    
  } catch (error) {
    console.error('❌ 스크리닝 실패:', error);
  }
}

testDiverseScreening();