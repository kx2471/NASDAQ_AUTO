const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const axios = require('axios');

// 색상 코드
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

class InteractiveTradeInput {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    this.trades = [];
    this.exchangeRate = null;
    this.exchangeRateExpiry = null;
  }

  // 색상 출력
  color(text, color) {
    return `${colors[color]}${text}${colors.reset}`;
  }

  // 질문하기
  question(query) {
    return new Promise(resolve => {
      this.rl.question(query, resolve);
    });
  }

  // 실시간 환율 조회 (캐시 포함)
  async getExchangeRate() {
    const now = Date.now();

    // 캐시가 유효한 경우 (5분)
    if (this.exchangeRate && this.exchangeRateExpiry && now < this.exchangeRateExpiry) {
      return this.exchangeRate;
    }

    try {
      console.log(this.color('💱 환율 조회 중...', 'yellow'));

      // exchangerate-api.com 무료 API 사용
      const response = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', {
        timeout: 5000
      });

      if (!response.data.rates || !response.data.rates.KRW) {
        throw new Error('환율 데이터를 찾을 수 없습니다');
      }

      this.exchangeRate = response.data.rates.KRW;
      this.exchangeRateExpiry = now + (5 * 60 * 1000); // 5분 캐시

      console.log(this.color(`💱 현재 환율: ${this.exchangeRate.toFixed(2)}원/달러`, 'green'));

      return this.exchangeRate;

    } catch (error) {
      console.log(this.color(`⚠️ 환율 조회 실패: ${error.message}`, 'yellow'));
      console.log(this.color('기본값 1392원/달러 사용', 'yellow'));

      // 기본값 사용
      this.exchangeRate = 1392;
      this.exchangeRateExpiry = now + (1 * 60 * 1000); // 1분 후 재시도

      return this.exchangeRate;
    }
  }

  // 달러를 원화로 환산
  formatKRW(usdAmount, exchangeRate) {
    const krwAmount = usdAmount * exchangeRate;
    return `₩${krwAmount.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`;
  }

  // 시작 메시지
  showWelcome() {
    console.clear();
    console.log(this.color('='.repeat(50), 'cyan'));
    console.log(this.color('📈 대화형 매매 입력기', 'bright'));
    console.log(this.color('='.repeat(50), 'cyan'));
    console.log('');
  }

  // 메인 메뉴
  async showMainMenu() {
    console.log(this.color('\n📋 메뉴를 선택하세요:', 'yellow'));
    console.log('1️⃣  매수 입력');
    console.log('2️⃣  매도 입력');
    console.log('3️⃣  입력된 거래 확인');
    console.log('4️⃣  모든 거래 저장 & Git 커밋');
    console.log('5️⃣  현재 포트폴리오 확인');
    console.log('0️⃣  종료');
    console.log('');

    const choice = await this.question('선택 (0-5): ');
    return choice;
  }

  // 매매 정보 입력
  async inputTradeInfo(side) {
    const sideText = side === 'BUY' ? '매수' : '매도';
    const sideColor = side === 'BUY' ? 'green' : 'red';

    console.log(this.color(`\n💰 ${sideText} 정보를 입력하세요:`, sideColor));

    // 환율 미리 조회 (백그라운드)
    const exchangeRatePromise = this.getExchangeRate();

    const symbol = await this.question('종목 코드: ');
    if (!symbol) {
      console.log(this.color('❌ 종목 코드를 입력해주세요.', 'red'));
      return null;
    }

    const qtyStr = await this.question('수량: ');
    const qty = parseFloat(qtyStr);
    if (isNaN(qty) || qty <= 0) {
      console.log(this.color('❌ 올바른 수량을 입력해주세요.', 'red'));
      return null;
    }

    const priceStr = await this.question('가격 ($): ');
    const price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) {
      console.log(this.color('❌ 올바른 가격을 입력해주세요.', 'red'));
      return null;
    }

    const note = await this.question('메모 (선택사항): ') || `${sideText} 거래`;

    const trade = {
      side,
      symbol: symbol.toUpperCase(),
      qty,
      price,
      note,
      amount: qty * price
    };

    // 환율 조회 완료 대기
    const exchangeRate = await exchangeRatePromise;

    // 확인
    console.log(this.color('\n📊 입력된 거래 정보:', 'yellow'));
    console.log(`종목: ${this.color(trade.symbol, 'bright')}`);
    console.log(`${sideText}: ${this.color(`${trade.qty}주`, 'bright')}`);
    console.log(`가격: ${this.color(`$${trade.price}`, 'bright')}`);
    console.log(`총액: ${this.color(`$${trade.amount.toFixed(2)}`, sideColor)} (${this.color(this.formatKRW(trade.amount, exchangeRate), sideColor)})`);
    console.log(`메모: ${trade.note}`);

    const confirm = await this.question('\n저장하시겠습니까? (y/n): ');

    if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
      this.trades.push(trade);
      console.log(this.color('✅ 거래가 임시 저장되었습니다.', 'green'));
      return trade;
    } else {
      console.log(this.color('❌ 거래가 취소되었습니다.', 'yellow'));
      return null;
    }
  }

  // 입력된 거래 목록 표시
  async showPendingTrades() {
    if (this.trades.length === 0) {
      console.log(this.color('\n📝 입력된 거래가 없습니다.', 'yellow'));
      return;
    }

    // 환율 조회
    const exchangeRate = await this.getExchangeRate();

    console.log(this.color('\n📋 입력된 거래 목록:', 'yellow'));
    console.log(this.color('-'.repeat(60), 'cyan'));

    let totalBuy = 0;
    let totalSell = 0;

    this.trades.forEach((trade, index) => {
      const sideColor = trade.side === 'BUY' ? 'green' : 'red';
      const sideText = trade.side === 'BUY' ? '매수' : '매도';

      console.log(`${index + 1}. ${this.color(trade.symbol, 'bright')} - ${this.color(sideText, sideColor)}`);
      console.log(`   수량: ${trade.qty}주, 가격: $${trade.price}, 총액: $${trade.amount.toFixed(2)} (${this.formatKRW(trade.amount, exchangeRate)})`);
      console.log(`   메모: ${trade.note}`);
      console.log('');

      if (trade.side === 'BUY') {
        totalBuy += trade.amount;
      } else {
        totalSell += trade.amount;
      }
    });

    console.log(this.color('-'.repeat(60), 'cyan'));
    console.log(`${this.color('매수 총액:', 'green')} $${totalBuy.toFixed(2)} (${this.formatKRW(totalBuy, exchangeRate)})`);
    console.log(`${this.color('매도 총액:', 'red')} $${totalSell.toFixed(2)} (${this.formatKRW(totalSell, exchangeRate)})`);
    console.log(`${this.color('순 현금 변동:', 'blue')} $${(totalSell - totalBuy).toFixed(2)} (${this.formatKRW(totalSell - totalBuy, exchangeRate)})`);
  }

  // 거래 저장 및 Git 커밋
  async saveAllTrades() {
    if (this.trades.length === 0) {
      console.log(this.color('\n❌ 저장할 거래가 없습니다.', 'red'));
      return;
    }

    console.log(this.color('\n💾 거래를 저장하고 있습니다...', 'yellow'));

    try {
      // 기존 add-trade.js 로직 사용
      for (let i = 0; i < this.trades.length; i++) {
        const trade = this.trades[i];
        console.log(`${i + 1}/${this.trades.length}: ${trade.symbol} ${trade.side}...`);

        await this.addTradeToFile(trade);

        // 잠시 대기 (너무 빠르면 같은 시간으로 기록될 수 있음)
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(this.color('✅ 모든 거래가 저장되었습니다!', 'green'));

      // Git 커밋 여부 확인
      const gitCommit = await this.question('\nGit에 자동 커밋하시겠습니까? (y/n): ');

      if (gitCommit.toLowerCase() === 'y' || gitCommit.toLowerCase() === 'yes') {
        await this.gitCommit();
      }

      // 저장된 거래 목록 초기화
      this.trades = [];

    } catch (error) {
      console.log(this.color(`❌ 저장 실패: ${error.message}`, 'red'));
    }
  }

  // 거래를 trades.json에 추가 (기존 add-trade.js 로직)
  async addTradeToFile(trade) {
    const tradesFile = path.join(process.cwd(), 'data', 'json', 'trades.json');

    let trades = [];
    try {
      const data = await fs.readFile(tradesFile, 'utf8');
      trades = JSON.parse(data);
    } catch (error) {
      // 파일이 없으면 빈 배열로 시작
      console.log('거래 파일이 없어 새로 생성합니다.');
    }

    // 새 거래 생성
    const newTrade = {
      traded_at: new Date().toISOString(),
      symbol: trade.symbol,
      side: trade.side,
      qty: trade.qty,
      price: trade.price,
      fee: 0,
      note: trade.note,
      id: Math.max(0, ...trades.map(t => t.id)) + 1
    };

    trades.push(newTrade);

    // 파일 저장
    await fs.writeFile(tradesFile, JSON.stringify(trades, null, 2));
  }

  // Git 커밋
  async gitCommit() {
    console.log(this.color('\n📤 Git 커밋 중...', 'yellow'));

    try {
      // git pull 먼저 실행
      console.log(this.color('📥 최신 변경사항 가져오는 중...', 'yellow'));
      await this.runCommand('git', ['pull']);

      // git add
      await this.runCommand('git', ['add', 'data/json/trades.json']);

      // 간단한 커밋 메시지 (특수문자 제거)
      const tradeCount = this.trades.length;
      const commitMsg = `Trading update: ${tradeCount} trades added`;

      // git commit with quoted message
      await this.runCommand('git', ['commit', '-m', `"${commitMsg}"`]);

      // git push
      await this.runCommand('git', ['push']);

      console.log(this.color('✅ Git 커밋 완료!', 'green'));

    } catch (error) {
      console.log(this.color(`❌ Git 커밋 실패: ${error.message}`, 'red'));
      console.log(this.color('수동으로 커밋하세요: git pull && git add . && git commit -m "Trading update" && git push', 'yellow'));
    }
  }

  // 명령어 실행
  runCommand(command, args) {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args, {
        stdio: 'pipe',
        shell: true
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`명령어 실행 실패: ${command} ${args.join(' ')}`));
        }
      });

      process.on('error', reject);
    });
  }

  // 포트폴리오 확인
  async showPortfolio() {
    console.log(this.color('\n💼 현재 포트폴리오를 확인합니다...', 'yellow'));

    return new Promise((resolve) => {
      const process = spawn('node', ['tools/check-balance.js'], {
        stdio: 'inherit',
        shell: true
      });

      process.on('close', () => {
        console.log('\n');
        resolve();
      });
    });
  }

  // 메인 루프
  async run() {
    this.showWelcome();

    while (true) {
      try {
        const choice = await this.showMainMenu();

        switch (choice) {
          case '1':
            await this.inputTradeInfo('BUY');
            break;

          case '2':
            await this.inputTradeInfo('SELL');
            break;

          case '3':
            await this.showPendingTrades();
            break;

          case '4':
            await this.saveAllTrades();
            break;

          case '5':
            await this.showPortfolio();
            break;

          case '0':
            console.log(this.color('\n👋 프로그램을 종료합니다.', 'yellow'));
            this.rl.close();
            return;

          default:
            console.log(this.color('\n❌ 올바른 번호를 선택해주세요.', 'red'));
        }

        // 계속하기 전에 잠시 대기
        if (choice !== '0') {
          await this.question('\n계속하려면 Enter를 누르세요...');
        }

      } catch (error) {
        console.log(this.color(`\n❌ 오류가 발생했습니다: ${error.message}`, 'red'));
        await this.question('계속하려면 Enter를 누르세요...');
      }
    }
  }
}

// 실행
if (require.main === module) {
  const app = new InteractiveTradeInput();
  app.run().catch(console.error);
}

module.exports = InteractiveTradeInput;