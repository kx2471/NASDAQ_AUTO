const { StockDiscoveryEngine } = require('./dist/services/discovery');

/**
 * 다양한 종목 발견 실행 스크립트
 * Alpha Vantage에서 더 다양한 종목들을 샘플링해서 가져옴
 */
async function discoverDiverseStocks() {
  console.log('🔍 다양한 종목 발견 프로세스 시작...');
  
  const engine = new StockDiscoveryEngine();
  
  // 모든 섹터에 대해 종목 발견 실행
  const sectors = {
    'ai': {
      title: 'AI & Machine Learning',
      description: 'AI, ML 관련 기술 기업들',
      keywords: ['artificial intelligence', 'machine learning', 'AI', 'neural network', 'deep learning'],
      industries: ['Technology', 'Software'],
      market_cap_min: 100000000,
      max_symbols: 50
    },
    'computing': {
      title: 'Cloud & Computing',
      description: '클라우드 및 컴퓨팅 서비스 기업들',
      keywords: ['cloud', 'computing', 'server', 'datacenter', 'infrastructure'],
      industries: ['Technology', 'Software'],
      market_cap_min: 100000000,
      max_symbols: 50
    },
    'nuclear': {
      title: 'Nuclear & Clean Energy',
      description: '원자력 및 청정에너지 기업들',
      keywords: ['nuclear', 'clean energy', 'renewable', 'uranium', 'solar', 'wind'],
      industries: ['Energy', 'Utilities'],
      market_cap_min: 50000000,
      max_symbols: 50
    }
  };
  
  for (const [sectorCode, sectorConfig] of Object.entries(sectors)) {
    try {
      console.log(`\n📊 ${sectorConfig.title} 섹터 종목 발견 중...`);
      
      const discoveredStocks = await engine.discoverStocksForSector(sectorCode, sectorConfig);
      await engine.saveDiscoveredStocks(discoveredStocks);
      
      console.log(`✅ ${sectorConfig.title}: ${discoveredStocks.length}개 종목 발견 완료`);
      
      // 섹터 간 대기 (API 제한 준수)
      await new Promise(resolve => setTimeout(resolve, 5000));
      
    } catch (error) {
      console.error(`❌ ${sectorCode} 섹터 발견 실패:`, error);
    }
  }
  
  console.log('\n🎉 다양한 종목 발견 프로세스 완료!');
}

// 실행
discoverDiverseStocks().catch(console.error);