# 🚀 Supabase 마이그레이션 가이드

## 📋 개요

현재 JSON 파일 기반 데이터 저장 시스템을 Supabase PostgreSQL로 마이그레이션하는 완전한 가이드입니다.

## 🎯 마이그레이션 이점

### 현재 시스템 (JSON 파일)
- ✅ 간단한 설정
- ✅ 로컬 파일 시스템 사용
- ❌ 동시성 제한
- ❌ 확장성 제한
- ❌ 백업 및 복구 복잡

### 마이그레이션 후 (Supabase)
- ✅ PostgreSQL 데이터베이스
- ✅ 실시간 동기화
- ✅ 자동 백업
- ✅ 확장성 및 성능
- ✅ SQL 쿼리 지원
- ✅ 웹 대시보드 제공

## 📋 마이그레이션 단계별 가이드

### Step 1: Supabase 프로젝트 생성

1. [supabase.com](https://supabase.com)에서 계정 생성
2. 새 프로젝트 생성
3. 데이터베이스 비밀번호 설정
4. 프로젝트 설정에서 API 키 확인

### Step 2: 환경 변수 설정

`.env` 파일에 Supabase 정보 추가:

```bash
# Supabase Database
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Migration Settings
ENABLE_SUPABASE_MIGRATION=true
BACKUP_JSON_FILES=true
```

### Step 3: 데이터베이스 스키마 생성

Supabase Dashboard의 SQL Editor에서 다음 스크립트 실행:

```bash
# SQL 스크립트 파일 사용
cat scripts/supabase-schema.sql
```

또는 Supabase Dashboard에서 수동으로 테이블 생성.

### Step 4: 데이터 마이그레이션 실행

```bash
# 프로젝트 빌드 (필수)
npm run build

# 마이그레이션 스크립트 실행
npm run migrate
# 또는
node scripts/migrate-to-supabase.js
```

### Step 5: 마이그레이션 검증

```bash
# 연결 테스트
node -e "
require('dotenv').config();
const { testSupabaseConnection } = require('./dist/services/supabase');
testSupabaseConnection().then(result => {
  console.log('Connection test:', result ? 'SUCCESS' : 'FAILED');
  process.exit(result ? 0 : 1);
});
"

# 데이터 검증
node -e "
require('dotenv').config();
const { getHoldings, getCashBalance } = require('./dist/storage/database');
(async () => {
  const holdings = await getHoldings();
  const cash = await getCashBalance();
  console.log('Holdings:', holdings.length, 'Cash:', cash);
})();
"
```

## 🔧 마이그레이션 옵션

### 점진적 마이그레이션 (권장)

1. `ENABLE_SUPABASE_MIGRATION=false`로 시작
2. 스키마 생성 및 연결 테스트
3. 데이터 마이그레이션 실행
4. 검증 완료 후 `ENABLE_SUPABASE_MIGRATION=true` 설정

### 전체 마이그레이션

처음부터 `ENABLE_SUPABASE_MIGRATION=true`로 설정하고 한번에 전환.

## 📊 마이그레이션된 데이터 구조

### 1. trades 테이블
```sql
- id: UUID (자동 생성)
- symbol: VARCHAR(10)
- side: 'BUY' | 'SELL'
- qty: DECIMAL(10,4)
- price: DECIMAL(10,2)
- fee: DECIMAL(10,2)
- executed_at: TIMESTAMP
```

### 2. cash_events 테이블
```sql
- id: UUID (자동 생성)
- type: 'DEPOSIT' | 'WITHDRAWAL'
- amount: DECIMAL(10,2)
- description: TEXT
- created_at: TIMESTAMP
```

### 3. symbols 테이블
```sql
- symbol: VARCHAR(10) PRIMARY KEY
- name: VARCHAR(255)
- exchange: VARCHAR(20)
- sector: VARCHAR(50)
- industry: VARCHAR(100)
- active: BOOLEAN
- avg_volume: BIGINT
- market_cap: BIGINT
```

### 4. performance_history 테이블
```sql
- id: UUID (자동 생성)
- date: DATE UNIQUE
- total_investment_krw: DECIMAL(15,2)
- current_value_krw: DECIMAL(15,2)
- total_return_krw: DECIMAL(15,2)
- total_return_percent: DECIMAL(8,4)
- target_progress: DECIMAL(8,4)
```

## 🚨 주의사항

### 데이터 백업
마이그레이션 전 자동으로 JSON 파일들이 `data/json-backup/` 디렉토리에 백업됩니다.

### 롤백 계획
문제 발생시:
1. `ENABLE_SUPABASE_MIGRATION=false` 설정
2. 백업된 JSON 파일들을 `data/json/`로 복원
3. 시스템 재시작

### GitHub Actions
마이그레이션 후 GitHub Actions에 환경변수 추가:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `ENABLE_SUPABASE_MIGRATION` (true)

## 🔍 문제 해결

### 연결 오류
```bash
Error: Invalid JWT
```
→ SUPABASE_SERVICE_KEY가 올바른지 확인

### 마이그레이션 오류
```bash
Error: relation "trades" does not exist
```
→ SQL 스키마가 제대로 생성되었는지 확인

### 데이터 불일치
```bash
Holdings count mismatch
```
→ 마이그레이션 스크립트를 다시 실행하거나 수동으로 데이터 검증

## 📈 성능 개선

마이그레이션 후 다음과 같은 성능 개선을 기대할 수 있습니다:

- **쿼리 속도**: JSON 파일 읽기 대비 10-50배 빠른 쿼리
- **동시성**: 다중 접근 지원
- **확장성**: 대용량 데이터 처리 가능
- **백업**: 자동 백업 및 복구

## 🎉 마이그레이션 완료

마이그레이션이 성공적으로 완료되면:
1. 일일 리포트 정상 생성 확인
2. 포트폴리오 계산 정확성 검증
3. GitHub Actions 정상 동작 확인
4. Supabase 대시보드에서 데이터 확인

마이그레이션에 대한 질문이나 문제가 있으면 GitHub Issues를 통해 문의하세요.