import express from 'express';
import { getHoldings, getCashBalance, getRecentReports } from '../../storage/database';

const router = express.Router();

/**
 * 데이터베이스 현황을 웹에서 볼 수 있는 API 엔드포인트들
 */

// 포트폴리오 전체 현황 조회
router.get('/portfolio', async (req, res) => {
  try {
    const [holdings, cashBalance] = await Promise.all([
      getHoldings(),
      getCashBalance()
    ]);

    const totalInvestment = holdings.reduce((sum, h) => sum + (h.shares * h.avg_cost), 0);
    const totalValue = totalInvestment + cashBalance;

    res.json({
      success: true,
      data: {
        holdings: holdings.map(h => ({
          symbol: h.symbol,
          shares: h.shares,
          avgCost: h.avg_cost,
          totalCost: h.shares * h.avg_cost
        })),
        cashBalance,
        summary: {
          totalHoldings: holdings.length,
          totalInvestment: totalInvestment,
          cashBalance,
          totalPortfolioValue: totalValue
        }
      }
    });
  } catch (error) {
    console.error('❌ 포트폴리오 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch portfolio data'
    });
  }
});

// 보유 종목 상세 조회
router.get('/holdings', async (req, res) => {
  try {
    const holdings = await getHoldings();
    
    res.json({
      success: true,
      data: holdings.map(h => ({
        symbol: h.symbol,
        shares: parseFloat(h.shares.toFixed(4)),
        avgCost: parseFloat(h.avg_cost.toFixed(2)),
        totalValue: parseFloat((h.shares * h.avg_cost).toFixed(2))
      })),
      count: holdings.length
    });
  } catch (error) {
    console.error('❌ 보유종목 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch holdings data'
    });
  }
});

// 현금 잔액 조회
router.get('/cash', async (req, res) => {
  try {
    const cashBalance = await getCashBalance();
    
    res.json({
      success: true,
      data: {
        balance: parseFloat(cashBalance.toFixed(2)),
        currency: 'USD'
      }
    });
  } catch (error) {
    console.error('❌ 현금잔액 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cash balance'
    });
  }
});

// 거래 기록 조회 (JSON 파일 직접 읽기)
router.get('/trades', async (req, res) => {
  try {
    const fs = require('fs/promises');
    const path = require('path');
    
    const tradesPath = path.join(process.cwd(), 'data', 'json', 'trades.json');
    const tradesData = JSON.parse(await fs.readFile(tradesPath, 'utf8'));
    
    // 최신 거래부터 정렬
    const sortedTrades = tradesData.sort((a: any, b: any) => 
      new Date(b.traded_at || b.executed_at).getTime() - new Date(a.traded_at || a.executed_at).getTime()
    );

    res.json({
      success: true,
      data: sortedTrades.map((trade: any) => ({
        id: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        qty: parseFloat(trade.qty),
        price: parseFloat(trade.price),
        fee: parseFloat(trade.fee || 0),
        executedAt: trade.traded_at || trade.executed_at,
        totalAmount: parseFloat(trade.qty) * parseFloat(trade.price)
      })),
      count: sortedTrades.length
    });
  } catch (error) {
    console.error('❌ 거래기록 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trades data'
    });
  }
});

// 현금 이벤트 조회 (JSON 파일 직접 읽기)
router.get('/cash-events', async (req, res) => {
  try {
    const fs = require('fs/promises');
    const path = require('path');
    
    const cashEventsPath = path.join(process.cwd(), 'data', 'json', 'cash_events.json');
    const cashEventsData = JSON.parse(await fs.readFile(cashEventsPath, 'utf8'));
    
    // 최신 이벤트부터 정렬
    const sortedEvents = cashEventsData.sort((a: any, b: any) => 
      new Date(b.occurred_at || b.created_at).getTime() - new Date(a.occurred_at || a.created_at).getTime()
    );

    res.json({
      success: true,
      data: sortedEvents.map((event: any) => ({
        id: event.id,
        type: event.type,
        amount: parseFloat(event.amount),
        note: event.note || event.description,
        occurredAt: event.occurred_at || event.created_at
      })),
      count: sortedEvents.length
    });
  } catch (error) {
    console.error('❌ 현금이벤트 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cash events data'
    });
  }
});

// 종목 리스트 조회 (활성 종목만)
router.get('/symbols', async (req, res) => {
  try {
    const fs = require('fs/promises');
    const path = require('path');
    
    const symbolsPath = path.join(process.cwd(), 'data', 'json', 'symbols.json');
    const symbolsData = JSON.parse(await fs.readFile(symbolsPath, 'utf8'));
    
    // 활성 종목만 필터링
    const activeSymbols = symbolsData.filter((symbol: any) => symbol.active !== false);

    res.json({
      success: true,
      data: activeSymbols.map((symbol: any) => ({
        symbol: symbol.symbol,
        name: symbol.name,
        exchange: symbol.exchange,
        sector: symbol.sector,
        industry: symbol.industry,
        active: symbol.active,
        quality: symbol.quality
      })),
      count: activeSymbols.length
    });
  } catch (error) {
    console.error('❌ 종목리스트 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch symbols data'
    });
  }
});

// 성과 기록 조회
router.get('/performance', async (req, res) => {
  try {
    const fs = require('fs/promises');
    const path = require('path');
    
    const perfPath = path.join(process.cwd(), 'data', 'json', 'performance_history.json');
    const perfData = JSON.parse(await fs.readFile(perfPath, 'utf8'));
    
    // 최신 날짜부터 정렬
    const sortedPerf = perfData.sort((a: any, b: any) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    res.json({
      success: true,
      data: sortedPerf.map((record: any) => ({
        date: record.date,
        totalInvestmentKrw: parseFloat(record.total_investment_krw),
        currentValueKrw: parseFloat(record.current_value_krw),
        totalReturnKrw: parseFloat(record.total_return_krw),
        totalReturnPercent: parseFloat(record.total_return_percent),
        targetProgress: parseFloat(record.target_progress)
      })),
      count: sortedPerf.length
    });
  } catch (error) {
    console.error('❌ 성과기록 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch performance data'
    });
  }
});

// 리포트 기록 조회
router.get('/reports', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const reports = await getRecentReports(limit);
    
    res.json({
      success: true,
      data: reports.map((report: any) => ({
        id: report.id,
        generatedAt: report.generated_at,
        type: report.type,
        status: report.status,
        aiModel: report.ai_model,
        symbolsAnalyzed: report.symbols_analyzed,
        filePath: report.file_path,
        summary: report.summary,
        errorMessage: report.error_message,
        processingTimeMs: report.processing_time_ms,
        processingTimeSeconds: report.processing_time_ms ? (report.processing_time_ms / 1000).toFixed(1) : null
      })),
      count: reports.length
    });
  } catch (error) {
    console.error('❌ 리포트 기록 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reports data'
    });
  }
});

// 데이터베이스 상태 종합 조회
router.get('/status', async (req, res) => {
  try {
    const fs = require('fs/promises');
    const path = require('path');
    const dataDir = path.join(process.cwd(), 'data', 'json');
    
    const [holdings, cashBalance] = await Promise.all([
      getHoldings(),
      getCashBalance()
    ]);

    // 파일 크기 및 수정 시간 확인
    const files = ['trades.json', 'cash_events.json', 'symbols.json', 'performance_history.json'];
    const fileStats: any = {};
    
    for (const file of files) {
      try {
        const filePath = path.join(dataDir, file);
        const stat = await fs.stat(filePath);
        const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
        
        fileStats[file] = {
          size: stat.size,
          records: Array.isArray(data) ? data.length : 0,
          lastModified: stat.mtime
        };
      } catch (error) {
        fileStats[file] = { error: 'File not found or corrupted' };
      }
    }

    res.json({
      success: true,
      data: {
        database: process.env.ENABLE_SUPABASE_MIGRATION === 'true' ? 'Supabase' : 'JSON Files',
        portfolio: {
          holdings: holdings.length,
          cashBalance: parseFloat(cashBalance.toFixed(2)),
          totalInvestment: holdings.reduce((sum, h) => sum + (h.shares * h.avg_cost), 0)
        },
        files: fileStats,
        environment: {
          nodeEnv: process.env.NODE_ENV,
          supabaseEnabled: process.env.ENABLE_SUPABASE_MIGRATION === 'true',
          lastReportTime: new Date().toISOString()
        }
      }
    });
  } catch (error) {
    console.error('❌ 데이터베이스 상태 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch database status'
    });
  }
});

export default router;