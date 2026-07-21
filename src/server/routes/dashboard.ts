import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { getHoldings, getCashBalance, db, Trade } from '../../storage/database';
import { getCachedExchangeRate } from '../../services/exchange';
import { getPrices, isDryRun, isUsRegularSessionOpen, getUsMarketCalendar, isTossEnabled, getOpenOrders } from '../../services/toss';
import { calculateCurrentPerformance, analyzeTargetProgress } from '../../services/performance';
import { getOpenPositions } from '../../storage/positions';

const router = express.Router();

/**
 * 대시보드 메인 페이지 (정적 파일 서빙)
 * GET /dashboard
 */
router.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'dashboard.html'));
});

/**
 * 포트폴리오 현황 API — 토스 실계좌 실시간
 * GET /dashboard/api/portfolio
 */
router.get('/api/portfolio', async (req, res) => {
  try {
    const [holdings, cashBalance, exchangeRate, openOrders] = await Promise.all([
      getHoldings(),
      getCashBalance(),
      getCachedExchangeRate(),
      getOpenOrders().catch(() => []) // 미체결 조회 실패해도 대시보드는 동작
    ]);

    // 보유 종목 현재가 (토스 실시간, 1콜)
    const symbols = holdings.map(h => h.symbol);
    const currentPrices = symbols.length > 0 ? await getPrices(symbols) : {};

    // 체결 대기 매수대금 (USD): 미체결 BUY 주문에 묶인 돈 — 현금도 보유도 아니지만
    // 여전히 내 자산이므로 평가액에 포함 (누락 시 주문 직후 수익률이 급락한 것처럼 보임)
    const pendingBuyUsd = openOrders
      .filter(o => o.side === 'BUY' && o.currency === 'USD')
      .reduce((sum, o) => sum + (o.orderAmount ?? ((o.quantity || 0) * (o.price || 0))), 0);

    // 성과 계산 (통화 인식 — KRW 종목은 환율 미적용, 현금+체결대기금 포함)
    const performance = calculateCurrentPerformance(holdings, currentPrices, exchangeRate.usd_to_krw, undefined, undefined, cashBalance + pendingBuyUsd);
    const targetAnalysis = analyzeTargetProgress(performance);

    res.json({
      success: true,
      data: {
        cash_usd: cashBalance,
        pending_buy_usd: Math.round(pendingBuyUsd * 100) / 100,
        open_orders: openOrders.map(o => ({
          symbol: o.symbol, side: o.side, status: o.status,
          quantity: o.quantity, price: o.price, orderAmount: o.orderAmount
        })),
        holdings: holdings.map(h => {
          const price = currentPrices[h.symbol] || 0;
          return {
            ...h,
            current_price: price,
            current_value: price * h.shares,
            pnl: (price - h.avg_cost) * h.shares,
            pnl_percent: h.avg_cost > 0 ? ((price - h.avg_cost) / h.avg_cost * 100) : 0
          };
        }),
        performance,
        targetAnalysis,
        exchangeRate: exchangeRate.usd_to_krw,
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('❌ 포트폴리오 데이터 조회 실패:', error);
    res.status(500).json({ success: false, error: '토스 실계좌 조회에 실패했습니다.' });
  }
});

/**
 * 성과 기록 API (수익률 추이 차트용)
 * GET /dashboard/api/performance
 */
router.get('/api/performance', async (req, res) => {
  try {
    const performanceFile = path.join(process.cwd(), 'data/json/performance_history.json');
    try {
      const data = await fs.readFile(performanceFile, 'utf-8');
      res.json({ success: true, data: JSON.parse(data) });
    } catch {
      res.json({ success: true, data: [] }); // 파일 없으면 빈 배열
    }
  } catch (error) {
    console.error('❌ 성과 데이터 조회 실패:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * 거래 내역 API (감사 기록, 최신순)
 * GET /dashboard/api/trades?limit=100
 */
router.get('/api/trades', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit || ''), 10) || 100, 500);
    const trades = await db.find<Trade>('trades');
    trades.sort((a, b) => new Date(b.traded_at).getTime() - new Date(a.traded_at).getTime());
    res.json({ success: true, data: trades.slice(0, limit), total: trades.length });
  } catch (error) {
    console.error('❌ 거래 내역 조회 실패:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * 보유 포지션 + 매매 계획 API (SL/TP)
 * GET /dashboard/api/positions
 */
router.get('/api/positions', async (req, res) => {
  try {
    const positions = await getOpenPositions();
    res.json({ success: true, data: positions });
  } catch (error) {
    console.error('❌ 포지션 조회 실패:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Manager 결정 이력 API
 * GET /dashboard/api/decisions?limit=10
 */
router.get('/api/decisions', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit || ''), 10) || 10, 50);
    const decisionsFile = path.join(process.cwd(), 'data/json/decisions.json');
    try {
      const data = JSON.parse(await fs.readFile(decisionsFile, 'utf-8'));
      const list = Array.isArray(data) ? data : [];
      list.sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)));
      res.json({ success: true, data: list.slice(0, limit) });
    } catch {
      res.json({ success: true, data: [] });
    }
  } catch (error) {
    console.error('❌ 결정 이력 조회 실패:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * 시스템 상태 API — dry-run 여부, 장 상태, 다음 개장
 * GET /dashboard/api/status
 */
router.get('/api/status', async (req, res) => {
  try {
    const status: Record<string, unknown> = {
      dryRun: isDryRun(),
      tossEnabled: isTossEnabled(),
      tossAuthOk: true as boolean,        // 토스 실호출 성공 여부 (IP 차단 등 감지)
      tossAuthError: null as null | string,
      schedulerEnabled: process.env.ENABLE_SCHEDULER !== 'false',
      reportLeadMinutes: parseInt(process.env.REPORT_LEAD_MINUTES || '', 10) || 40,
      sessionOpen: false,
      todayRegular: null as null | { start: string; end: string },
      nextBusinessDay: null as null | string
    };

    if (isTossEnabled()) {
      // 토스 실호출로 인증 생사 확인 — 실패해도 status는 정상 반환해서
      // 대시보드가 "토스 연결 끊김" 경고를 띄울 수 있게 한다 (IP 차단 등)
      try {
        const [open, calendar] = await Promise.all([isUsRegularSessionOpen(), getUsMarketCalendar()]);
        status.sessionOpen = open;
        status.todayRegular = calendar.today.regular
          ? { start: new Date(calendar.today.regular.start).toISOString(), end: new Date(calendar.today.regular.end).toISOString() }
          : null;
        status.nextBusinessDay = calendar.next.date;
        if (!calendar.today.regular && calendar.next.regular) {
          status.nextRegularStart = new Date(calendar.next.regular.start).toISOString();
        }
      } catch (tossError: any) {
        status.tossAuthOk = false;
        // IP 차단은 대표적 원인 — 메시지에서 식별해 사용자 안내에 활용
        const msg = String(tossError?.message || tossError);
        const isIpBlock = /IP address not allowed|access_denied|403/.test(msg);
        status.tossAuthError = isIpBlock
          ? 'IP 미허용 — 토스 API에 현재 IP를 등록해야 합니다 (정전·재접속으로 IP가 바뀌었을 수 있음)'
          : '토스 API 연결 실패 — 인증/네트워크 확인 필요';
        console.error('⚠️ 토스 인증 확인 실패 (대시보드 경고 표시):', msg.slice(0, 120));

        // IP 차단이면 현재 공인 IP를 함께 알려줘 등록을 쉽게 (실패해도 무시)
        if (isIpBlock) {
          try {
            const r = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(5000) });
            status.currentIp = (await r.text()).trim();
          } catch { /* IP 조회 실패는 무시 */ }
        }
      }
    }

    res.json({ success: true, data: status });
  } catch (error) {
    console.error('❌ 시스템 상태 조회 실패:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * 리포트 목록 API (data/report의 .md 파일, 최신순)
 * GET /dashboard/api/reports
 */
router.get('/api/reports', async (req, res) => {
  try {
    const reportDir = path.join(process.cwd(), 'data/report');
    const files = await fs.readdir(reportDir);

    const reports = files
      .filter(f => f.endsWith('.md'))
      .map(f => {
        // 파일명 패턴: YYYYMMDD[_HHMM]_<type>.md
        const m = f.match(/^(\d{8})(?:_(\d{4}))?_(.+)\.md$/);
        if (!m) return null;
        const [, d, t, type] = m;
        return {
          filename: f,
          date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}${t ? ` ${t.slice(0, 2)}:${t.slice(2, 4)}` : ''}`,
          sortKey: `${d}${t || '0000'}`,
          type: type.includes('manager') ? 'manager'
            : type.includes('claude') ? 'claude'
            : type.includes('gpt') ? 'gpt' : 'etc'
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
      .slice(0, 40);

    res.json({ success: true, data: reports });
  } catch (error) {
    console.error('❌ 리포트 목록 조회 실패:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * 리포트 내용 API
 * GET /dashboard/api/reports/:filename
 */
router.get('/api/reports/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    // 보안: 파일명 화이트리스트 검증 (경로 탈출 차단)
    if (!/^\d{8}(_\d{4})?_[a-z_]+\.md$/.test(filename)) {
      return res.status(400).json({ success: false, error: 'Invalid filename' });
    }
    const content = await fs.readFile(path.join(process.cwd(), 'data/report', filename), 'utf-8');
    res.json({ success: true, data: { filename, content } });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ success: false, error: 'Report not found' });
    } else {
      console.error('❌ 리포트 조회 실패:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
});

export default router;
