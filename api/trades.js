/**
 * Vercel Serverless Function - trades.json 읽기/쓰기 API
 *
 * GET /api/trades - 모든 거래 내역 조회
 * POST /api/trades - 새 거래 추가
 */

// GitHub 설정
const OWNER = 'kx2471';
const REPO = 'NASDAQ_AUTO';
const BRANCH = 'main';
const FILE_PATH = 'data/json/trades.json';

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
 * trades.json 파일 읽기
 */
async function readTrades(octokit) {
  try {
    const { data } = await octokit.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path: FILE_PATH,
      ref: BRANCH
    });

    const content = Buffer.from(data.content, 'base64').toString('utf8');
    const trades = JSON.parse(content);

    return {
      trades,
      sha: data.sha // 파일 업데이트 시 필요
    };
  } catch (error) {
    console.error('Failed to read trades:', error);
    throw new Error('거래 내역을 읽을 수 없습니다.');
  }
}

/**
 * trades.json 파일에 거래 추가
 */
async function addTrade(octokit, trade) {
  // 1. 현재 파일 읽기
  const { trades, sha } = await readTrades(octokit);

  // 2. 새 거래 추가
  const newTrade = {
    id: Math.max(0, ...trades.map(t => t.id || 0)) + 1,
    traded_at: new Date().toISOString(),
    symbol: trade.symbol.toUpperCase(),
    side: trade.side.toUpperCase(),
    qty: parseFloat(trade.qty),
    price: parseFloat(trade.price),
    fee: trade.fee || 0,
    note: trade.note || `${trade.side} 거래`
  };

  trades.push(newTrade);

  // 3. 파일 업데이트
  const newContent = Buffer.from(JSON.stringify(trades, null, 2)).toString('base64');

  await octokit.repos.createOrUpdateFileContents({
    owner: OWNER,
    repo: REPO,
    path: FILE_PATH,
    message: `Add trade: ${newTrade.symbol} ${newTrade.side} ${newTrade.qty}@${newTrade.price}`,
    content: newContent,
    sha: sha,
    branch: BRANCH
  });

  return newTrade;
}

/**
 * API Handler
 */
module.exports = async (req, res) => {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');

  // OPTIONS 요청 처리 (CORS preflight)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
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

    // GET - 거래 내역 조회
    if (req.method === 'GET') {
      const { trades } = await readTrades(octokit);

      return res.status(200).json({
        success: true,
        count: trades.length,
        trades: trades
      });
    }

    // POST - 새 거래 추가
    if (req.method === 'POST') {
      const { symbol, side, qty, price, note } = req.body;

      // 입력 검증
      if (!symbol || !side || !qty || !price) {
        return res.status(400).json({
          error: 'Missing required fields',
          required: ['symbol', 'side', 'qty', 'price']
        });
      }

      if (!['BUY', 'SELL'].includes(side.toUpperCase())) {
        return res.status(400).json({
          error: 'Invalid side',
          message: 'side must be BUY or SELL'
        });
      }

      const newTrade = await addTrade(octokit, { symbol, side, qty, price, note });

      return res.status(201).json({
        success: true,
        trade: newTrade
      });
    }

    // 지원하지 않는 메서드
    return res.status(405).json({
      error: 'Method not allowed',
      allowed: ['GET', 'POST']
    });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
};
