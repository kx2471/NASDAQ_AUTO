# 📈 Nasdaq AutoTrader 매매 가이드

이 문서는 Nasdaq AutoTrader 시스템에서 매수/매도를 입력하고 관리하는 완전한 가이드입니다.

## 🎯 시스템 구조

### 데이터 관리
- **현금 잔고**: `data/json/cash_events.json` - 입금/출금 및 매매로 인한 현금 변동
- **보유종목**: `data/json/trades.json` - 모든 매수/매도 거래 기록
- **포트폴리오 가치**: 현금 잔고 + (보유종목 × 현재 시장가)

### 핵심 원칙
- 현금과 보유종목은 **독립적으로 관리**됨
- 모든 매매는 **거래 기록으로 추적**됨
- **매도량 검증**: 보유량 초과 매도 방지

## 🛠️ 매매 입력 방법

### 1. 간편 스크립트 (권장)

#### 매수
```bash
node add-trade.js BUY <종목> <수량> <가격> [메모]
```

**예시:**
```bash
# AAPL 5주를 $180.50에 매수
node add-trade.js BUY AAPL 5 180.50 "애플 추가매수"

# NVDA 2주를 $177.38에 매수 (메모 없음)
node add-trade.js BUY NVDA 2 177.38
```

#### 매도
```bash
node add-trade.js SELL <종목> <수량> <가격> [메모]
```

**예시:**
```bash
# NVDA 1주를 $185.00에 매도
node add-trade.js SELL NVDA 1 185.00 "일부 익절"

# COIN 전량 매도
node add-trade.js SELL COIN 1 330.00 "전량 매도"
```

### 2. 수동 입력 (고급 사용자)

`data/json/trades.json`에 직접 추가:

```json
{
  "traded_at": "2025-09-15T16:00:00.000Z",
  "symbol": "AAPL",
  "side": "BUY",
  "qty": 5,
  "price": 180.50,
  "fee": 0,
  "note": "애플 추가매수",
  "id": 6
}
```

## 📊 잔고 및 포트폴리오 확인

### 현금 잔고 확인
```bash
node check-balance.js
```

**출력 예시:**
```
=== 거래 내역 분석 ===
입금: $2005.19
초기 잔고: $2005.19
매수 BABA: 1주 x $154.4 = -$154.40 (잔고: $1850.79)
매수 GOOGL: 4.866031주 x $240.46 = -$1170.09 (잔고: $680.70)
매도 NVDA: 0.5주 x $180 = +$90.00 (잔고: $90.01)

최종 현금 잔고: $90.01
원화 환산: ₩125,273
```

### 포트폴리오 가치 확인
```bash
node calculate-portfolio-value.js
```

## 🔒 안전 기능

### 자동 검증
- **매도량 검증**: 보유량보다 많은 수량 매도 시 자동 차단
- **입력 검증**: 음수 수량/가격 입력 방지
- **자동 ID 생성**: 거래 기록 ID 자동 증가

### 예시: 매도량 검증
```bash
# NVDA 10주 매도 시도 (보유량: 1.5주)
node add-trade.js SELL NVDA 10 180.00

# 결과: ❌ 매도 실패: 보유량(1.5주)이 매도량(10주)보다 적습니다.
```

## 📈 Manager Agent 연동

매매 입력 후 Manager Agent가 자동으로:
- 업데이트된 현금 잔고 반영
- 새로운 포트폴리오 구성 기반 매매 추천
- 가용 현금 범위 내 매수 지시

```bash
# 매매 후 Manager 리포트 확인
node test-manager-only.js
```

## 🎯 실전 사용 시나리오

### 시나리오 1: 일부 익절
```bash
# 1. 현재 보유량 확인
node check-balance.js

# 2. NVDA 50% 매도
node add-trade.js SELL NVDA 1 185.00 "50% 익절"

# 3. 현금 증가 확인
node check-balance.js

# 4. Manager 추천 확인
node test-manager-only.js
```

### 시나리오 2: 신규 매수
```bash
# 1. 현재 현금 확인
node check-balance.js

# 2. 새 종목 매수
node add-trade.js BUY MSFT 2 420.00 "신규 매수"

# 3. 포트폴리오 변화 확인
node calculate-portfolio-value.js
```

### 시나리오 3: 리밸런싱
```bash
# 1. 일부 종목 매도
node add-trade.js SELL COIN 1 330.00 "리밸런싱"

# 2. 다른 종목 매수
node add-trade.js BUY GOOGL 2 240.00 "비중 증가"

# 3. 최종 포트폴리오 확인
node check-balance.js
```

## 🚨 주의사항

### 데이터 백업
매매 입력 전 데이터 백업 권장:
```bash
cp data/json/trades.json data/json/trades_backup_$(date +%Y%m%d_%H%M%S).json
```

### 입력 실수 시 수정
1. `data/json/trades.json`에서 해당 거래 기록 수정/삭제
2. `node check-balance.js`로 결과 확인

### Manager Agent 반영
- 매매 입력 후 **반드시** Manager Agent 실행하여 업데이트된 상태 확인
- 시스템이 Supabase 비활성화 상태이므로 JSON 파일 기반으로 동작

## 📋 도움말 및 명령어

```bash
# 매매 스크립트 도움말
node add-trade.js --help

# 현금 잔고 확인
node check-balance.js

# 포트폴리오 가치 계산
node calculate-portfolio-value.js

# Manager Agent 리포트
node test-manager-only.js

# 백업 생성
cp data/json/trades.json data/json/trades_backup_$(date +%Y%m%d_%H%M%S).json
```

## 📊 현재 시스템 상태 (2025-09-15 기준)

### 현재 포트폴리오
- **현금**: $90.01 (₩125,273)
- **보유종목**:
  - BABA: 1주 (평단 $154.40)
  - GOOGL: 4.866031주 (평단 $240.46)
  - NVDA: 1.5주 (평단 $177.38, 0.5주 매도됨)
  - COIN: 1주 (평단 $325.93)

### 설정 상태
- ✅ Supabase: 비활성화 (JSON 파일 기반)
- ✅ 안전장치: 활성화 (하드코딩 방지)
- ✅ 매도 검증: 활성화
- ✅ Manager Agent: 정상 작동

---

**작성일**: 2025-09-15  
**버전**: 1.0  
**마지막 업데이트**: Claude Code Assistant