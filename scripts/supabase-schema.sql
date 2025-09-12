-- ===================================================================
-- Supabase PostgreSQL 스키마 생성 스크립트
-- NASDAQ Auto Trading System 데이터베이스 마이그레이션용
-- ===================================================================

-- 1. trades 테이블 생성
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(10) NOT NULL,
  side VARCHAR(4) NOT NULL CHECK (side IN ('BUY', 'SELL')),
  qty DECIMAL(10,4) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  fee DECIMAL(10,2) DEFAULT 0,
  executed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. cash_events 테이블 생성
CREATE TABLE cash_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(10) NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAWAL')),
  amount DECIMAL(10,2) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. symbols 테이블 생성
CREATE TABLE symbols (
  symbol VARCHAR(10) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  exchange VARCHAR(20) NOT NULL,
  sector VARCHAR(50),
  industry VARCHAR(100),
  active BOOLEAN DEFAULT true,
  avg_volume BIGINT,
  market_cap BIGINT,
  is_active BOOLEAN DEFAULT true,
  has_minimum_data BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. performance_history 테이블 생성
CREATE TABLE performance_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  total_investment_krw DECIMAL(15,2) NOT NULL,
  current_value_krw DECIMAL(15,2) NOT NULL,
  total_return_krw DECIMAL(15,2) NOT NULL,
  total_return_percent DECIMAL(8,4) NOT NULL,
  target_progress DECIMAL(8,4) NOT NULL,
  exchange_rate DECIMAL(10,4),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. reports 테이블 생성 (리포트 생성 기록)
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('UNIFIED', 'SECTOR', 'MANUAL')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'PARTIAL')),
  ai_model VARCHAR(50),
  symbols_analyzed INTEGER DEFAULT 0,
  file_path TEXT,
  summary TEXT,
  error_message TEXT,
  processing_time_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ===================================================================
-- 인덱스 생성 (성능 최적화)
-- ===================================================================

-- trades 테이블 인덱스
CREATE INDEX idx_trades_symbol ON trades(symbol);
CREATE INDEX idx_trades_executed_at ON trades(executed_at);
CREATE INDEX idx_trades_side ON trades(side);
CREATE INDEX idx_trades_symbol_executed_at ON trades(symbol, executed_at);

-- symbols 테이블 인덱스
CREATE INDEX idx_symbols_active ON symbols(active);
CREATE INDEX idx_symbols_sector ON symbols(sector);
CREATE INDEX idx_symbols_exchange ON symbols(exchange);

-- performance_history 테이블 인덱스
CREATE INDEX idx_performance_history_date ON performance_history(date);

-- cash_events 테이블 인덱스
CREATE INDEX idx_cash_events_created_at ON cash_events(created_at);
CREATE INDEX idx_cash_events_type ON cash_events(type);

-- reports 테이블 인덱스
CREATE INDEX idx_reports_generated_at ON reports(generated_at);
CREATE INDEX idx_reports_type ON reports(type);
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_ai_model ON reports(ai_model);

-- ===================================================================
-- 트리거 생성 (자동 업데이트)
-- ===================================================================

-- symbols 테이블 updated_at 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_symbols_updated_at 
    BEFORE UPDATE ON symbols 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===================================================================
-- RLS (Row Level Security) 정책 (필요시 활성화)
-- ===================================================================

-- 현재는 서버 사이드 앱에서만 사용하므로 RLS 비활성화
-- 필요시 아래 주석을 해제하여 RLS 활성화

/*
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE symbols ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_history ENABLE ROW LEVEL SECURITY;

-- 서비스 롤에 대한 모든 권한 정책
CREATE POLICY "Service role can do everything" ON trades
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can do everything" ON cash_events
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can do everything" ON symbols
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can do everything" ON performance_history
    FOR ALL USING (true) WITH CHECK (true);
*/

-- ===================================================================
-- 유용한 뷰 생성 (포트폴리오 계산용)
-- ===================================================================

-- 현재 보유 종목 뷰
CREATE OR REPLACE VIEW current_holdings AS
SELECT 
    symbol,
    SUM(CASE WHEN side = 'BUY' THEN qty ELSE -qty END) as shares,
    SUM(CASE WHEN side = 'BUY' THEN (qty * price + fee) ELSE 0 END) / 
    NULLIF(SUM(CASE WHEN side = 'BUY' THEN qty ELSE 0 END), 0) as avg_cost
FROM trades
GROUP BY symbol
HAVING SUM(CASE WHEN side = 'BUY' THEN qty ELSE -qty END) > 0;

-- 현금 잔액 뷰
CREATE OR REPLACE VIEW current_cash_balance AS
SELECT 
    COALESCE(
        (SELECT SUM(CASE WHEN type = 'DEPOSIT' THEN amount ELSE -amount END) 
         FROM cash_events), 0
    ) + COALESCE(
        (SELECT SUM(CASE WHEN side = 'BUY' THEN -(qty * price + fee) ELSE (qty * price - fee) END) 
         FROM trades), 0
    ) as cash_balance;

-- 포트폴리오 요약 뷰
CREATE OR REPLACE VIEW portfolio_summary AS
SELECT 
    (SELECT COUNT(*) FROM current_holdings) as total_holdings,
    (SELECT COALESCE(SUM(shares * avg_cost), 0) FROM current_holdings) as total_investment,
    (SELECT cash_balance FROM current_cash_balance) as cash_balance,
    (SELECT COUNT(*) FROM trades) as total_trades;

-- ===================================================================
-- 데이터 검증을 위한 함수들
-- ===================================================================

-- 포트폴리오 총 가치 계산 함수 (현재가는 외부에서 제공)
CREATE OR REPLACE FUNCTION calculate_portfolio_value(
    current_prices JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    symbol TEXT,
    shares NUMERIC,
    avg_cost NUMERIC,
    current_price NUMERIC,
    market_value NUMERIC,
    unrealized_pnl NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        h.symbol::TEXT,
        h.shares,
        h.avg_cost,
        COALESCE((current_prices ->> h.symbol)::NUMERIC, 0) as current_price,
        h.shares * COALESCE((current_prices ->> h.symbol)::NUMERIC, 0) as market_value,
        h.shares * (COALESCE((current_prices ->> h.symbol)::NUMERIC, 0) - h.avg_cost) as unrealized_pnl
    FROM current_holdings h;
END;
$$ LANGUAGE plpgsql;

-- ===================================================================
-- 마이그레이션 상태 추적 테이블
-- ===================================================================

CREATE TABLE migration_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation VARCHAR(50) NOT NULL,
    table_name VARCHAR(50),
    records_processed INTEGER DEFAULT 0,
    success BOOLEAN DEFAULT false,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ===================================================================
-- 초기 데이터 삽입 (예시)
-- ===================================================================

-- 마이그레이션 시작 로그
INSERT INTO migration_log (operation, table_name, records_processed, success)
VALUES ('SCHEMA_CREATION', 'ALL', 0, true);

-- ===================================================================
-- 권한 설정 (필요시)
-- ===================================================================

-- 서비스 롤에 모든 테이블에 대한 권한 부여
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ===================================================================
-- 스키마 생성 완료
-- ===================================================================

-- 스키마 버전 정보
COMMENT ON SCHEMA public IS 'NASDAQ Auto Trading System Database Schema v1.0';
COMMENT ON TABLE trades IS '거래 기록 테이블 - 매수/매도 거래 내역';
COMMENT ON TABLE cash_events IS '현금 이벤트 테이블 - 입금/출금 기록';
COMMENT ON TABLE symbols IS '종목 정보 테이블 - 거래 가능한 주식 목록';
COMMENT ON TABLE performance_history IS '성과 기록 테이블 - 일별 포트폴리오 성과';

SELECT 'Supabase 스키마 생성 완료! 🎉' as message;