const fs = require('fs').promises;
const path = require('path');

// 사용법 안내
function showUsage() {
  console.log('📈 매매 입력 스크립트');
  console.log('');
  console.log('사용법:');
  console.log('  node add-trade.js BUY <종목> <수량> <가격> [메모]');
  console.log('  node add-trade.js SELL <종목> <수량> <가격> [메모]');
  console.log('');
  console.log('예시:');
  console.log('  node add-trade.js BUY AAPL 5 180.50 "애플 추가매수"');
  console.log('  node add-trade.js SELL NVDA 1 185.00 "일부 익절"');
  console.log('');
}

async function addTrade() {
  const args = process.argv.slice(2);
  
  // 인수 확인
  if (args.length < 4) {
    showUsage();
    process.exit(1);
  }
  
  const [side, symbol, qtyStr, priceStr, note] = args;
  
  // 매매 방향 확인
  if (side !== 'BUY' && side !== 'SELL') {
    console.error('❌ 매매 방향은 BUY 또는 SELL이어야 합니다.');
    process.exit(1);
  }
  
  // 수량과 가격 검증
  const qty = parseFloat(qtyStr);
  const price = parseFloat(priceStr);
  
  if (isNaN(qty) || qty <= 0) {
    console.error('❌ 수량은 0보다 큰 숫자여야 합니다.');
    process.exit(1);
  }
  
  if (isNaN(price) || price <= 0) {
    console.error('❌ 가격은 0보다 큰 숫자여야 합니다.');
    process.exit(1);
  }
  
  try {
    // trades.json 읽기
    const tradesPath = path.join(__dirname, 'data', 'json', 'trades.json');
    let trades = [];
    
    try {
      const tradesData = await fs.readFile(tradesPath, 'utf8');
      trades = JSON.parse(tradesData);
    } catch (error) {
      console.log('새로운 trades.json 파일을 생성합니다.');
    }
    
    // 새 거래 ID 생성
    const newId = trades.length > 0 ? Math.max(...trades.map(t => t.id || 0)) + 1 : 1;
    
    // 새 거래 기록 생성
    const newTrade = {
      traded_at: new Date().toISOString(),
      symbol: symbol.toUpperCase(),
      side: side,
      qty: qty,
      price: price,
      fee: 0,
      note: note || `${side} ${symbol.toUpperCase()}`,
      id: newId
    };
    
    // 매도 시 보유량 확인
    if (side === 'SELL') {
      // 현재 보유량 계산
      const holdings = {};
      trades.forEach(trade => {
        if (!holdings[trade.symbol]) {
          holdings[trade.symbol] = 0;
        }
        if (trade.side === 'BUY') {
          holdings[trade.symbol] += trade.qty;
        } else if (trade.side === 'SELL') {
          holdings[trade.symbol] -= trade.qty;
        }
      });
      
      const currentHolding = holdings[symbol.toUpperCase()] || 0;
      if (currentHolding < qty) {
        console.error(`❌ 매도 실패: 보유량(${currentHolding}주)이 매도량(${qty}주)보다 적습니다.`);
        process.exit(1);
      }
    }
    
    // 거래 추가
    trades.push(newTrade);
    
    // 파일 저장
    await fs.writeFile(tradesPath, JSON.stringify(trades, null, 2));
    
    // 결과 출력
    const action = side === 'BUY' ? '매수' : '매도';
    const amount = qty * price;
    
    console.log('✅ 거래 기록 추가 완료!');
    console.log('');
    console.log(`📊 ${action} 내역:`);
    console.log(`  종목: ${symbol.toUpperCase()}`);
    console.log(`  수량: ${qty}주`);
    console.log(`  가격: $${price.toFixed(2)}`);
    console.log(`  금액: $${amount.toFixed(2)}`);
    console.log(`  시간: ${new Date().toLocaleString('ko-KR')}`);
    if (note) console.log(`  메모: ${note}`);
    console.log('');
    
    // 현금 잔고 변화 안내
    if (side === 'BUY') {
      console.log(`💰 현금 잔고: -$${amount.toFixed(2)} (매수)`);
    } else {
      console.log(`💰 현금 잔고: +$${amount.toFixed(2)} (매도)`);
    }
    
    console.log('');
    console.log('현재 잔고 확인: node check-balance.js');
    
  } catch (error) {
    console.error('❌ 거래 추가 실패:', error.message);
    process.exit(1);
  }
}

// 도움말 또는 거래 추가 실행
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showUsage();
} else {
  addTrade();
}