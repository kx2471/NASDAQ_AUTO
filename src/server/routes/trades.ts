import { Router } from 'express';
import { db, Trade } from '../../storage/database';

const router = Router();

/**
 * 거래 기록 추가 엔드포인트
 * POST /v1/trades
 */
router.post('/', async (req, res) => {
  try {
    const { symbol, side, qty, price, fee = 0, note = '' } = req.body;

    // 입력값 검증
    if (!symbol || !side || !qty || !price) {
      return res.status(400).json({ 
        error: 'symbol, side, qty, price는 필수 입력값입니다' 
      });
    }

    if (!['BUY', 'SELL'].includes(side)) {
      return res.status(400).json({ 
        error: 'side는 BUY 또는 SELL이어야 합니다' 
      });
    }

    if (qty <= 0 || price <= 0) {
      return res.status(400).json({ 
        error: 'qty와 price는 0보다 커야 합니다' 
      });
    }

    // 거래 기록 저장
    const trade: Omit<Trade, 'id'> = {
      traded_at: new Date().toISOString(),
      symbol: symbol.toUpperCase(),
      side: side as 'BUY' | 'SELL',
      qty: parseFloat(qty),
      price: parseFloat(price),
      fee: parseFloat(fee),
      note: note || ''
    };

    const savedTrade = await db.insert('trades', trade);

    console.log(`✅ 거래 기록 추가: ${symbol} ${side} ${qty}주 @${price}`);

    res.status(201).json({
      success: true,
      trade: savedTrade
    });

  } catch (error) {
    console.error('❌ 거래 기록 추가 실패:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 거래 기록 조회 엔드포인트
 * GET /v1/trades
 */
router.get('/', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const allTrades = await db.find<Trade>('trades');
    
    // 날짜순 정렬 (최신순)
    const sortedTrades = allTrades.sort((a, b) => 
      new Date(b.traded_at).getTime() - new Date(a.traded_at).getTime()
    );

    // 페이지네이션 적용
    const startIndex = parseInt(offset as string) || 0;
    const pageSize = parseInt(limit as string) || 50;
    const paginatedTrades = sortedTrades.slice(startIndex, startIndex + pageSize);

    res.json({
      success: true,
      trades: paginatedTrades,
      count: paginatedTrades.length,
      total: allTrades.length
    });

  } catch (error) {
    console.error('❌ 거래 기록 조회 실패:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;