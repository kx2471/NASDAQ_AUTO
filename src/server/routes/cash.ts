import { Router } from 'express';
import { db, CashEvent, getCashBalance } from '../../storage/database';

const router = Router();

/**
 * 현금 입출금 기록 추가 엔드포인트
 * POST /v1/cash
 */
router.post('/', async (req, res) => {
  try {
    const { type, amount, note = '' } = req.body;

    // 입력값 검증
    if (!type || !amount) {
      return res.status(400).json({ 
        error: 'type과 amount는 필수 입력값입니다' 
      });
    }

    if (!['DEPOSIT', 'WITHDRAW'].includes(type)) {
      return res.status(400).json({ 
        error: 'type은 DEPOSIT 또는 WITHDRAW이어야 합니다' 
      });
    }

    if (amount <= 0) {
      return res.status(400).json({ 
        error: 'amount는 0보다 커야 합니다' 
      });
    }

    // 현금 이벤트 기록 저장
    const cashEvent: Omit<CashEvent, 'id'> = {
      occurred_at: new Date().toISOString(),
      type: type as 'DEPOSIT' | 'WITHDRAW',
      amount: parseFloat(amount),
      note: note || ''
    };

    const savedEvent = await db.insert('cash_events', cashEvent);

    console.log(`✅ 현금 이벤트 추가: ${type} $${amount}`);

    res.status(201).json({
      success: true,
      cash_event: savedEvent
    });

  } catch (error) {
    console.error('❌ 현금 이벤트 추가 실패:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 현금 잔액 조회 엔드포인트
 * GET /v1/cash/balance
 */
router.get('/balance', async (req, res) => {
  try {
    const balance = await getCashBalance();

    res.json({
      success: true,
      balance: balance
    });

  } catch (error) {
    console.error('❌ 현금 잔액 조회 실패:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 현금 이벤트 기록 조회 엔드포인트
 * GET /v1/cash/events
 */
router.get('/events', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const allEvents = await db.find<CashEvent>('cash_events');
    
    // 날짜순 정렬 (최신순)
    const sortedEvents = allEvents.sort((a, b) => 
      new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
    );

    // 페이지네이션 적용
    const startIndex = parseInt(offset as string) || 0;
    const pageSize = parseInt(limit as string) || 50;
    const paginatedEvents = sortedEvents.slice(startIndex, startIndex + pageSize);

    res.json({
      success: true,
      events: paginatedEvents,
      count: paginatedEvents.length,
      total: allEvents.length
    });

  } catch (error) {
    console.error('❌ 현금 이벤트 조회 실패:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;