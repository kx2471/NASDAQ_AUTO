const fs = require('fs');
const path = require('path');

/**
 * 다양한 종목을 수동으로 추가하는 스크립트
 * 유명한 나스닥 종목들을 여러 섹터에 걸쳐 추가
 */
function addDiverseStocks() {
  console.log('📊 다양한 종목 추가 시작...');
  
  // 현재 symbols.json 읽기
  const symbolsPath = path.join(__dirname, 'data', 'json', 'symbols.json');
  let symbols = [];
  
  try {
    const data = fs.readFileSync(symbolsPath, 'utf8');
    symbols = JSON.parse(data);
    console.log(`📈 현재 ${symbols.length}개 종목 로드됨`);
  } catch (error) {
    console.error('❌ symbols.json 읽기 실패:', error);
    return;
  }
  
  // 추가할 다양한 종목들 (실제 유명 나스닥 종목들)
  const diverseStocks = [
    // 대형 테크 종목들
    { symbol: "GOOGL", name: "Alphabet Inc Class A", sector: "ai", exchange: "NASDAQ" },
    { symbol: "GOOG", name: "Alphabet Inc Class C", sector: "ai", exchange: "NASDAQ" },
    { symbol: "META", name: "Meta Platforms Inc", sector: "ai", exchange: "NASDAQ" },
    { symbol: "NVDA", name: "NVIDIA Corporation", sector: "ai", exchange: "NASDAQ" },
    { symbol: "MSFT", name: "Microsoft Corporation", sector: "computing", exchange: "NASDAQ" },
    { symbol: "AMZN", name: "Amazon.com Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "TSLA", name: "Tesla Inc", sector: "nuclear", exchange: "NASDAQ" },
    { symbol: "NFLX", name: "Netflix Inc", sector: "computing", exchange: "NASDAQ" },
    
    // B로 시작하는 종목들
    { symbol: "BIDU", name: "Baidu Inc ADR", sector: "ai", exchange: "NASDAQ" },
    { symbol: "BABA", name: "Alibaba Group Holding Ltd ADR", sector: "computing", exchange: "NASDAQ" },
    { symbol: "BIIB", name: "Biogen Inc", sector: "nuclear", exchange: "NASDAQ" },
    { symbol: "BMRN", name: "BioMarin Pharmaceutical Inc", sector: "nuclear", exchange: "NASDAQ" },
    { symbol: "BBBY", name: "Bed Bath & Beyond Inc", sector: "computing", exchange: "NASDAQ" },
    
    // C로 시작하는 종목들
    { symbol: "CSCO", name: "Cisco Systems Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "COST", name: "Costco Wholesale Corporation", sector: "computing", exchange: "NASDAQ" },
    { symbol: "CMCSA", name: "Comcast Corporation Class A", sector: "computing", exchange: "NASDAQ" },
    { symbol: "CRWD", name: "CrowdStrike Holdings Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "COIN", name: "Coinbase Global Inc", sector: "ai", exchange: "NASDAQ" },
    
    // D로 시작하는 종목들
    { symbol: "DOCU", name: "DocuSign Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "DXCM", name: "DexCom Inc", sector: "nuclear", exchange: "NASDAQ" },
    { symbol: "DLTR", name: "Dollar Tree Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "DISH", name: "DISH Network Corporation", sector: "computing", exchange: "NASDAQ" },
    
    // E, F로 시작하는 종목들
    { symbol: "EBAY", name: "eBay Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "EXPE", name: "Expedia Group Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "FAST", name: "Fastenal Company", sector: "computing", exchange: "NASDAQ" },
    { symbol: "FB", name: "Meta Platforms Inc", sector: "ai", exchange: "NASDAQ" }, // 이전 Facebook
    
    // G, H로 시작하는 종목들
    { symbol: "GILD", name: "Gilead Sciences Inc", sector: "nuclear", exchange: "NASDAQ" },
    { symbol: "HON", name: "Honeywell International Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "HSIC", name: "Henry Schein Inc", sector: "nuclear", exchange: "NASDAQ" },
    
    // I, J, K로 시작하는 종목들
    { symbol: "INTC", name: "Intel Corporation", sector: "computing", exchange: "NASDAQ" },
    { symbol: "ILMN", name: "Illumina Inc", sector: "nuclear", exchange: "NASDAQ" },
    { symbol: "JD", name: "JD.com Inc ADR", sector: "computing", exchange: "NASDAQ" },
    { symbol: "KDP", name: "Keurig Dr Pepper Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "KHC", name: "Kraft Heinz Company", sector: "computing", exchange: "NASDAQ" },
    
    // L, M로 시작하는 종목들
    { symbol: "LRCX", name: "Lam Research Corporation", sector: "computing", exchange: "NASDAQ" },
    { symbol: "LCID", name: "Lucid Group Inc", sector: "nuclear", exchange: "NASDAQ" },
    { symbol: "MRNA", name: "Moderna Inc", sector: "nuclear", exchange: "NASDAQ" },
    { symbol: "MELI", name: "MercadoLibre Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "MDLZ", name: "Mondelez International Inc", sector: "computing", exchange: "NASDAQ" },
    
    // N, O, P로 시작하는 종목들
    { symbol: "NTES", name: "NetEase Inc ADR", sector: "ai", exchange: "NASDAQ" },
    { symbol: "OKTA", name: "Okta Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "ORLY", name: "O'Reilly Automotive Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "PYPL", name: "PayPal Holdings Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "PAYX", name: "Paychex Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "PCAR", name: "PACCAR Inc", sector: "computing", exchange: "NASDAQ" },
    
    // Q, R, S로 시작하는 종목들
    { symbol: "QCOM", name: "QUALCOMM Incorporated", sector: "computing", exchange: "NASDAQ" },
    { symbol: "REGN", name: "Regeneron Pharmaceuticals Inc", sector: "nuclear", exchange: "NASDAQ" },
    { symbol: "ROST", name: "Ross Stores Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "SBUX", name: "Starbucks Corporation", sector: "computing", exchange: "NASDAQ" },
    { symbol: "SIRI", name: "Sirius XM Holdings Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "SWKS", name: "Skyworks Solutions Inc", sector: "computing", exchange: "NASDAQ" },
    
    // T, U, V로 시작하는 종목들
    { symbol: "TMUS", name: "T-Mobile US Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "TEAM", name: "Atlassian Corporation", sector: "computing", exchange: "NASDAQ" },
    { symbol: "UBER", name: "Uber Technologies Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "VRTX", name: "Vertex Pharmaceuticals Incorporated", sector: "nuclear", exchange: "NASDAQ" },
    { symbol: "VRSK", name: "Verisk Analytics Inc", sector: "ai", exchange: "NASDAQ" },
    
    // W, X, Y, Z로 시작하는 종목들
    { symbol: "WBA", name: "Walgreens Boots Alliance Inc", sector: "nuclear", exchange: "NASDAQ" },
    { symbol: "WDAY", name: "Workday Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "XEL", name: "Xcel Energy Inc", sector: "nuclear", exchange: "NASDAQ" },
    { symbol: "ZM", name: "Zoom Video Communications Inc", sector: "computing", exchange: "NASDAQ" },
    { symbol: "ZS", name: "Zscaler Inc", sector: "computing", exchange: "NASDAQ" }
  ];
  
  // 기존 심볼들 확인 (중복 방지)
  const existingSymbols = new Set(symbols.map(s => s.symbol));
  
  // 새로운 종목들 추가
  let addedCount = 0;
  for (const stock of diverseStocks) {
    if (!existingSymbols.has(stock.symbol)) {
      symbols.push({
        symbol: stock.symbol,
        name: stock.name,
        exchange: stock.exchange,
        sector: stock.sector,
        industry: "Unknown",
        active: true,
        quality: {
          symbol: stock.symbol,
          isActive: true,
          hasMinimumData: true,
          avgVolume: 1000000, // 기본값
          marketCap: 1000000000 // 기본값
        }
      });
      addedCount++;
    }
  }
  
  // 파일 저장
  try {
    fs.writeFileSync(symbolsPath, JSON.stringify(symbols, null, 2));
    console.log(`✅ ${addedCount}개의 새로운 종목 추가 완료`);
    console.log(`📊 총 ${symbols.length}개 종목으로 업데이트됨`);
    
    // 섹터별 분포 확인
    const sectorCount = {};
    symbols.forEach(s => {
      if (s.active) {
        sectorCount[s.sector] = (sectorCount[s.sector] || 0) + 1;
      }
    });
    
    console.log('\n📈 섹터별 분포:');
    Object.entries(sectorCount).forEach(([sector, count]) => {
      console.log(`  ${sector}: ${count}개`);
    });
    
  } catch (error) {
    console.error('❌ symbols.json 저장 실패:', error);
  }
}

addDiverseStocks();