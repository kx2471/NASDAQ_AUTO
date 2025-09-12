# 📊 Supabase DB 마이그레이션 지시서

## 🎯 목표
현재 JSON 기반 데이터 저장 시스템을 Supabase PostgreSQL로 마이그레이션

## 📋 현재 상태 (2024-09-12)
- **브랜치**: `feature/database-migration`
- **현재 시스템**: JSON 파일 기반 (`data/json/*.json`)
- **자동 메일**: 매일 오후 4시 GitHub Actions 실행 (`main` 브랜치)
- **포트폴리오**: TSLA 4.6112주, PL 31주 보유중
- **성과**: +18.96% 수익률, 1000만원 목표 27.77% 진행

## 🗂️ 마이그레이션 대상 데이터

### 1. 보유 종목 데이터 (`trades.json` → `trades` 테이블)
```json
{
  "id": "uuid",
  "symbol": "TSLA",
  "side": "BUY",
  "qty": 4.6112,
  "price": 318.02,
  "fee": 1.25,
  "executed_at": "2024-09-10T10:30:00Z"
}
```

### 2. 현금 이벤트 (`cash_events.json` → `cash_events` 테이블)
```json
{
  "id": "uuid",
  "type": "DEPOSIT",
  "amount": 2000.00,
  "description": "초기 투자금",
  "created_at": "2024-09-01T00:00:00Z"
}
```

### 3. 종목 데이터 (`symbols.json` → `symbols` 테이블)
```json
{
  "symbol": "TSLA",
  "name": "Tesla Inc",
  "exchange": "NASDAQ",
  "sector": "nuclear",
  "industry": "Unknown",
  "active": true,
  "quality": {
    "symbol": "TSLA",
    "isActive": true,
    "hasMinimumData": true,
    "avgVolume": 1000000,
    "marketCap": 1000000000
  }
}
```

### 4. 성과 기록 (`performance_history.json` → `performance_history` 테이블)
```json
{
  "id": "uuid",
  "date": "2024-09-11",
  "total_investment_krw": 2334490,
  "current_value_krw": 2777113,
  "total_return_krw": 442623,
  "total_return_percent": 18.96,
  "target_progress": 27.77
}
```

## 🏗️ Supabase 스키마 설계

### 1. `trades` 테이블
```sql
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
```

### 2. `cash_events` 테이블
```sql
CREATE TABLE cash_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(10) NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAWAL')),
  amount DECIMAL(10,2) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 3. `symbols` 테이블
```sql
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
```

### 4. `performance_history` 테이블
```sql
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
```

## 🛠️ 마이그레이션 단계별 작업

### Phase 1: Supabase 설정
1. Supabase 프로젝트 생성
2. 환경변수 설정 (`.env`)
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_KEY=your-service-role-key
   ```
3. Supabase 클라이언트 설치
   ```bash
   npm install @supabase/supabase-js
   ```

### Phase 2: 데이터베이스 스키마 생성
1. Supabase Dashboard에서 SQL Editor 사용
2. 위 스키마 SQL 실행
3. 인덱스 추가:
   ```sql
   CREATE INDEX idx_trades_symbol ON trades(symbol);
   CREATE INDEX idx_trades_executed_at ON trades(executed_at);
   CREATE INDEX idx_performance_history_date ON performance_history(date);
   ```

### Phase 3: 서비스 레이어 구현
1. `src/services/supabase.ts` 생성
2. JSON 데이터베이스 함수들을 Supabase 버전으로 재구현:
   - `getHoldings()` → Supabase aggregation query
   - `getCashBalance()` → Supabase sum query
   - `addTrade()` → Supabase insert
   - `addCashEvent()` → Supabase insert

### Phase 4: 데이터 마이그레이션
1. `scripts/migrate-to-supabase.js` 스크립트 작성
2. JSON 파일들을 읽어서 Supabase 테이블에 INSERT
3. 데이터 무결성 검증 스크립트 작성

### Phase 5: 코드 업데이트
1. `src/storage/database.ts` 업데이트
2. Supabase 클라이언트 사용하도록 모든 데이터 액세스 변경
3. 기존 JSON 파일 의존성 제거

### Phase 6: 테스트 및 검증
1. 로컬에서 Supabase 연결 테스트
2. 포트폴리오 계산 정확성 검증
3. 리포트 생성 테스트
4. GitHub Actions 환경변수 설정

## 🔧 핵심 구현 파일들

### 1. `src/services/supabase.ts` (새로 생성)
```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

// 기존 database.ts의 함수들을 Supabase 버전으로 재구현
export async function getHoldings(): Promise<Holding[]> {
  // Supabase aggregation query 구현
}

export async function getCashBalance(): Promise<number> {
  // Supabase sum query 구현
}
```

### 2. `scripts/migrate-to-supabase.js` (새로 생성)
```javascript
// JSON 데이터를 읽어서 Supabase로 이전하는 스크립트
const fs = require('fs')
const { supabase } = require('../dist/services/supabase')

async function migrateData() {
  // trades.json → trades 테이블
  // cash_events.json → cash_events 테이블  
  // symbols.json → symbols 테이블
  // performance_history.json → performance_history 테이블
}
```

## ⚠️ 주의사항

### 1. 환경변수 보안
- Supabase 키를 GitHub Secrets에 안전하게 저장
- 서비스 롤 키 사용 (ANON 키 아님)

### 2. 데이터 백업
- 마이그레이션 전 JSON 파일들 백업
- Supabase에서 정기적 백업 설정

### 3. 롤백 계획
- 문제 발생시 `main` 브랜치로 즉시 되돌리기
- JSON 파일 기반 시스템 유지

### 4. 비용 관리
- Supabase 무료 플랜 한도 모니터링
- 쿼리 최적화로 API 호출 수 절약

## 🎯 성공 기준

### 기능 테스트
- [ ] 포트폴리오 보유량 정확히 계산 (TSLA 4.6112주, PL 31주)
- [ ] 현금 잔액 정확히 계산
- [ ] 성과 추적 정상 작동 (+18.96% 수익률)
- [ ] 일일 리포트 생성 정상 작동
- [ ] 메일 발송 정상 작동

### 성능 테스트
- [ ] 리포트 생성 시간 2분 이내 (현재와 동일)
- [ ] GitHub Actions 제한시간 내 완료
- [ ] 동시 접근 처리 (향후 확장성)

## 📝 완료 후 문서 업데이트
1. `README.md` 업데이트 (Supabase 설정 가이드)
2. `CLAUDE.md` 업데이트 (새로운 아키텍처 반영)
3. API 문서 작성 (Supabase 스키마 및 함수들)

---
**작성일**: 2024-09-12  
**브랜치**: `feature/database-migration`  
**담당**: Claude Code  
**상태**: 준비 완료, 작업 대기중