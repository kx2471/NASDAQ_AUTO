/**
 * Vercel Serverless Function - 포트폴리오 조회 API
 *
 * GET /api/portfolio - 현재 보유 주식 및 현금 조회
 */

/**
 * GitHub API 클라이언트 생성
 */
async function createOctokit(token) {
  const { Octokit } = await import('@octokit/rest');
  return new Octokit({
    auth: token
  });
}

/**
 * GitHub에서 파일 읽기
 */
async function readFileFromGitHub(octokit, filePath) {
  try {
    const { data } = await octokit.repos.getContent({
      owner: 'kx2471',
      repo: 'NASDAQ_AUTO',
      path: filePath,
      ref: 'main'
    });

    const content = Buffer.from(data.content, 'base64').toString('utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to read ${filePath}:`, error);
    return null;
  }
}

/**
 * 거래 내역으로부터 보유 주식 계산
 *
 * 평단가 계산 방식: totalCost / buyShares (전체 매수량 기준)
 * - buyShares: 총 매수한 주식 수 (매도 시 변경 안함)
 * - totalCost: 총 매수 비용 (매도 시 변경 안함)
 * - qty: 현재 보유량 (BUY +, SELL -)
 */
function calculateHoldings(trades) {
  const holdings = {};

  trades.forEach(trade => {
    const symbol = trade.symbol;
    const qty = parseFloat(trade.qty);
    const price = parseFloat(trade.price);

    if (!holdings[symbol]) {
      holdings[symbol] = {
        symbol: symbol,
        qty: 0,           // 현재 보유량
        buyShares: 0,     // 총 매수량 (평단가 계산용)
        totalCost: 0,     // 총 매수 비용
        avgPrice: 0,
        trades: []
      };
    }

    if (trade.side === 'BUY') {
      holdings[symbol].qty += qty;
      holdings[symbol].buyShares += qty;
      holdings[symbol].totalCost += qty * price;
      holdings[symbol].trades.push({
        date: trade.traded_at,
        side: 'BUY',
        qty: qty,
        price: price
      });
    } else if (trade.side === 'SELL') {
      holdings[symbol].qty -= qty;
      holdings[symbol].trades.push({
        date: trade.traded_at,
        side: 'SELL',
        qty: qty,
        price: price
      });

      // 보유량이 0이 되면 평단가 리셋 (이동평균법)
      if (Math.abs(holdings[symbol].qty) < 0.0001) {
        holdings[symbol].totalCost = 0;
        holdings[symbol].buyShares = 0;
        holdings[symbol].qty = 0;
      }
    }

    // 평균 단가 계산: totalCost / buyShares (전체 매수량 기준)
    if (holdings[symbol].buyShares > 0) {
      holdings[symbol].avgPrice = holdings[symbol].totalCost / holdings[symbol].buyShares;
    } else {
      holdings[symbol].avgPrice = 0;
    }
  });

  // 보유량이 0이거나 거의 0인 종목 제거 (부동소수점 오차 고려)
  Object.keys(holdings).forEach(symbol => {
    if (Math.abs(holdings[symbol].qty) < 0.001) {
      delete holdings[symbol];
    }
  });

  return holdings;
}

/**
 * 현금 잔고 계산
 */
function calculateCashBalance(cashEvents, trades) {
  let balance = 0;

  // 입출금 내역
  if (cashEvents) {
    cashEvents.forEach(event => {
      if (event.type === 'DEPOSIT') {
        balance += parseFloat(event.amount);
      } else if (event.type === 'WITHDRAW') {
        balance -= parseFloat(event.amount);
      }
    });
  }

  // 거래 내역 반영
  trades.forEach(trade => {
    const amount = parseFloat(trade.qty) * parseFloat(trade.price);
    if (trade.side === 'BUY') {
      balance -= amount; // 매수 시 현금 감소
    } else if (trade.side === 'SELL') {
      balance += amount; // 매도 시 현금 증가
    }
  });

  return balance;
}

/**
 * API Handler
 */
module.exports = async (req, res) => {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');

  // OPTIONS 요청 처리
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed',
      allowed: ['GET']
    });
  }

  try {
    // 인증 토큰 확인
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authorization header required',
        message: 'Authorization: Bearer YOUR_GITHUB_TOKEN'
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const octokit = await createOctokit(token);

    // 파일 읽기
    const [trades, cashEvents] = await Promise.all([
      readFileFromGitHub(octokit, 'data/json/trades.json'),
      readFileFromGitHub(octokit, 'data/json/cash_events.json')
    ]);

    if (!trades) {
      return res.status(500).json({
        error: 'Failed to load trades data'
      });
    }

    // 보유 주식 계산
    const holdings = calculateHoldings(trades);
    const holdingsArray = Object.values(holdings);

    // 현금 잔고 계산
    const cashBalance = calculateCashBalance(cashEvents || [], trades);

    // 총 투자액 계산
    const totalInvested = holdingsArray.reduce((sum, h) => sum + h.totalCost, 0);

    return res.status(200).json({
      success: true,
      portfolio: {
        cash: {
          balance: cashBalance,
          formatted: `$${cashBalance.toFixed(2)}`
        },
        holdings: holdingsArray.map(h => ({
          symbol: h.symbol,
          qty: h.qty,
          avgPrice: h.avgPrice,
          totalCost: h.totalCost,
          formatted: {
            qty: h.qty.toFixed(2),
            avgPrice: `$${h.avgPrice.toFixed(2)}`,
            totalCost: `$${h.totalCost.toFixed(2)}`
          }
        })),
        summary: {
          totalSymbols: holdingsArray.length,
          totalInvested: totalInvested,
          totalValue: totalInvested, // 실시간 시세는 별도 API 필요
          cashBalance: cashBalance,
          totalAssets: totalInvested + cashBalance
        }
      }
    });

  } catch (error) {
    console.error('Portfolio API Error:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
};
