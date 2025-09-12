const fs = require('fs');

// 종목 데이터 확인
const symbols = JSON.parse(fs.readFileSync('data/json/symbols.json', 'utf8'));

console.log('📊 총 종목 수:', symbols.length);

const activeSymbols = symbols.filter(s => s.active);
console.log('📈 활성 종목 수:', activeSymbols.length);

// 섹터별 분포
const sectorCount = {};
activeSymbols.forEach(s => {
  sectorCount[s.sector] = (sectorCount[s.sector] || 0) + 1;
});

console.log('\n📈 섹터별 분포:');
Object.entries(sectorCount).forEach(([sector, count]) => {
  console.log(`  ${sector}: ${count}개`);
});

// 알파벳별 분포 확인
const letterCount = {};
activeSymbols.forEach(s => {
  const firstLetter = s.symbol[0];
  letterCount[firstLetter] = (letterCount[firstLetter] || 0) + 1;
});

console.log('\n🔤 첫 글자별 분포:');
Object.keys(letterCount).sort().forEach(letter => {
  console.log(`  ${letter}: ${letterCount[letter]}개`);
});

// 유명 종목들 확인
const famousStocks = ['AAPL', 'GOOGL', 'META', 'NVDA', 'MSFT', 'AMZN', 'TSLA', 'NFLX'];
const foundFamous = famousStocks.filter(symbol => 
  activeSymbols.some(s => s.symbol === symbol)
);

console.log('\n⭐ 유명 종목들 포함 여부:');
console.log(`  포함된 종목: ${foundFamous.join(', ')}`);
console.log(`  누락된 종목: ${famousStocks.filter(s => !foundFamous.includes(s)).join(', ') || '없음'}`);

// 각 섹터별 샘플 종목들
console.log('\n🎯 섹터별 샘플 종목들:');
Object.keys(sectorCount).forEach(sector => {
  const sectorStocks = activeSymbols.filter(s => s.sector === sector).slice(0, 5);
  const stockNames = sectorStocks.map(s => s.symbol);
  console.log(`  ${sector}: ${stockNames.join(', ')}`);
});