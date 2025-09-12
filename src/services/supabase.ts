import { createClient } from '@supabase/supabase-js';

/**
 * Supabase 클라이언트 설정 및 데이터베이스 연결
 */
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * 데이터베이스 연결 테스트
 */
export async function testSupabaseConnection(): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('trades')
      .select('count')
      .limit(1);
    
    if (error) {
      console.error('❌ Supabase 연결 테스트 실패:', error);
      return false;
    }
    
    console.log('✅ Supabase 연결 성공');
    return true;
  } catch (error) {
    console.error('❌ Supabase 연결 실패:', error);
    return false;
  }
}

/**
 * 거래 기록 관련 함수들
 */

// 거래 기록 추가
export async function addTrade(trade: {
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  fee: number;
  executed_at: string;
}): Promise<any> {
  const { data, error } = await supabase
    .from('trades')
    .insert([trade])
    .select()
    .single();

  if (error) {
    console.error('❌ 거래 기록 추가 실패:', error);
    throw error;
  }

  return data;
}

// 모든 거래 기록 조회
export async function getAllTrades(): Promise<any[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .order('executed_at', { ascending: false });

  if (error) {
    console.error('❌ 거래 기록 조회 실패:', error);
    throw error;
  }

  return data || [];
}

/**
 * 현금 이벤트 관련 함수들
 */

// 현금 이벤트 추가
export async function addCashEvent(cashEvent: {
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amount: number;
  description?: string;
}): Promise<any> {
  const { data, error } = await supabase
    .from('cash_events')
    .insert([cashEvent])
    .select()
    .single();

  if (error) {
    console.error('❌ 현금 이벤트 추가 실패:', error);
    throw error;
  }

  return data;
}

// 모든 현금 이벤트 조회
export async function getAllCashEvents(): Promise<any[]> {
  const { data, error } = await supabase
    .from('cash_events')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ 현금 이벤트 조회 실패:', error);
    throw error;
  }

  return data || [];
}

/**
 * 종목 관련 함수들
 */

// 종목 추가/업데이트 (UPSERT)
export async function upsertSymbol(symbol: {
  symbol: string;
  name: string;
  exchange: string;
  sector?: string;
  industry?: string;
  active?: boolean;
  avg_volume?: number;
  market_cap?: number;
  is_active?: boolean;
  has_minimum_data?: boolean;
}): Promise<any> {
  const { data, error } = await supabase
    .from('symbols')
    .upsert([symbol], { onConflict: 'symbol' })
    .select()
    .single();

  if (error) {
    console.error('❌ 종목 업데이트 실패:', error);
    throw error;
  }

  return data;
}

// 활성 종목들 조회
export async function getActiveSymbols(): Promise<any[]> {
  const { data, error } = await supabase
    .from('symbols')
    .select('*')
    .eq('active', true)
    .eq('is_active', true);

  if (error) {
    console.error('❌ 활성 종목 조회 실패:', error);
    throw error;
  }

  return data || [];
}

/**
 * 성과 기록 관련 함수들
 */

// 일별 성과 기록 추가
export async function addPerformanceHistory(performance: {
  date: string;
  total_investment_krw: number;
  current_value_krw: number;
  total_return_krw: number;
  total_return_percent: number;
  target_progress: number;
  exchange_rate?: number;
}): Promise<any> {
  const { data, error } = await supabase
    .from('performance_history')
    .upsert([performance], { onConflict: 'date' })
    .select()
    .single();

  if (error) {
    console.error('❌ 성과 기록 추가 실패:', error);
    throw error;
  }

  return data;
}

// 최근 성과 기록 조회
export async function getRecentPerformance(limit: number = 30): Promise<any[]> {
  const { data, error } = await supabase
    .from('performance_history')
    .select('*')
    .order('date', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('❌ 성과 기록 조회 실패:', error);
    throw error;
  }

  return data || [];
}

/**
 * 포트폴리오 계산 함수들 (Supabase 버전)
 */

// 현재 보유 종목 계산
export async function getHoldings(): Promise<Array<{
  symbol: string;
  shares: number;
  avg_cost: number;
}>> {
  const { data: trades, error } = await supabase
    .from('trades')
    .select('symbol, side, qty, price, fee')
    .order('executed_at', { ascending: true });

  if (error) {
    console.error('❌ 거래 기록 조회 실패:', error);
    throw error;
  }

  // 보유량 계산 로직
  const holdingsMap = new Map<string, { totalShares: number; totalCost: number; buyShares: number }>();

  for (const trade of trades || []) {
    const existing = holdingsMap.get(trade.symbol) || { totalShares: 0, totalCost: 0, buyShares: 0 };
    
    if (trade.side === 'BUY') {
      existing.totalShares += trade.qty;
      existing.totalCost += trade.qty * trade.price + trade.fee;
      existing.buyShares += trade.qty;
    } else {
      existing.totalShares -= trade.qty;
      // 매도시에는 평균 단가 조정하지 않음
    }
    
    holdingsMap.set(trade.symbol, existing);
  }

  const holdings: Array<{symbol: string; shares: number; avg_cost: number}> = [];
  for (const [symbol, data] of holdingsMap) {
    if (data.totalShares > 0) {
      holdings.push({
        symbol,
        shares: data.totalShares,
        avg_cost: data.buyShares > 0 ? data.totalCost / data.buyShares : 0
      });
    }
  }

  return holdings;
}

// 현금 잔액 계산
export async function getCashBalance(): Promise<number> {
  const [cashEventsResult, tradesResult] = await Promise.allSettled([
    supabase.from('cash_events').select('type, amount'),
    supabase.from('trades').select('side, qty, price, fee')
  ]);

  // 입출금 합계
  let cashFlow = 0;
  if (cashEventsResult.status === 'fulfilled' && cashEventsResult.value.data) {
    for (const event of cashEventsResult.value.data) {
      cashFlow += event.type === 'DEPOSIT' ? event.amount : -event.amount;
    }
  }

  // 거래로 인한 현금 변동
  let tradingCash = 0;
  if (tradesResult.status === 'fulfilled' && tradesResult.value.data) {
    for (const trade of tradesResult.value.data) {
      if (trade.side === 'BUY') {
        tradingCash -= (trade.qty * trade.price + trade.fee);
      } else {
        tradingCash += (trade.qty * trade.price - trade.fee);
      }
    }
  }

  return cashFlow + tradingCash;
}

/**
 * 리포트 기록 관련 함수들
 */

// 리포트 기록 추가
export async function addReportRecord(report: {
  generated_at: string;
  type: 'UNIFIED' | 'SECTOR' | 'MANUAL';
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
  ai_model?: string;
  symbols_analyzed: number;
  file_path?: string;
  summary?: string;
  error_message?: string;
  processing_time_ms?: number;
}): Promise<any> {
  const { data, error } = await supabase
    .from('reports')
    .insert([report])
    .select()
    .single();

  if (error) {
    console.error('❌ 리포트 기록 추가 실패:', error);
    throw error;
  }

  return data;
}

// 최근 리포트 기록 조회
export async function getRecentReports(limit: number = 10): Promise<any[]> {
  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .order('generated_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('❌ 리포트 기록 조회 실패:', error);
    throw error;
  }

  return data || [];
}