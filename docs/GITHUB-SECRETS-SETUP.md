# GitHub Secrets 설정 가이드

GitHub Actions에서 실시간 주식 가격 시스템을 사용하려면 다음 Secrets를 추가해야 합니다.

## 🔐 Alpaca API Secrets 추가

### Step 1: GitHub Repository Settings 접속

1. GitHub 저장소 페이지로 이동
2. **Settings** 탭 클릭
3. 좌측 메뉴에서 **Secrets and variables** → **Actions** 클릭

### Step 2: New repository secret 추가

**"New repository secret"** 버튼을 클릭하여 다음 3개의 Secrets를 추가:

#### 1. ALPACA_API_KEY

```
Name: ALPACA_API_KEY
Secret: PK4BWQZSGPZLRJEPOTNGNOAZK6
```

- ✅ **Save secret** 클릭

#### 2. ALPACA_SECRET_KEY

```
Name: ALPACA_SECRET_KEY
Secret: 31DLL7WmZGp7frMMfmwsvgAUfksy85PYdCyh5RcTRErE
```

- ✅ **Save secret** 클릭

#### 3. ALPACA_PAPER (선택사항)

```
Name: ALPACA_PAPER
Secret: true
```

- ✅ **Save secret** 클릭
- ℹ️ 이 설정은 워크플로우에서 `ALPACA_PAPER: true`로 하드코딩되어 있어 생략 가능합니다.

---

## 📋 전체 Secrets 목록 확인

다음 Secrets가 모두 설정되어 있는지 확인하세요:

### 기존 Secrets (이미 설정됨)

- ✅ `PORT`
- ✅ `API_KEY`
- ✅ `BASE_URL`
- ✅ `ALPHAVANTAGE_API_KEY`
- ✅ `FINNHUB_API_KEY`
- ✅ `NEWSAPI_API_KEY`
- ✅ `LLM_PROVIDER`
- ✅ `OPENAI_API_KEY`
- ✅ `LLM_MODEL`
- ✅ `GEMINI_API_KEY`
- ✅ `GEMINI_MODEL`
- ✅ `ENABLE_GEMINI_REPORT`
- ✅ `CLAUDE_API_KEY`
- ✅ `CLAUDE_MODEL`
- ✅ `GROK_API_KEY`
- ✅ `GROK_MODEL`
- ✅ `ENABLE_GROK_REPORT`
- ✅ `MANAGER_MODEL`
- ✅ `MAIL_PROVIDER`
- ✅ `RESEND_API_KEY`
- ✅ `MAIL_FROM`
- ✅ `MAIL_TO`
- ✅ `REPORT_LOOKBACK_DAYS`
- ✅ `MARKET_TZ`
- ✅ `SEND_TZ`
- ✅ `SEND_HOUR_LOCAL`
- ✅ `BACKUP_JSON_FILES`

### 새로 추가할 Secrets

- 🆕 `ALPACA_API_KEY` ← **필수**
- 🆕 `ALPACA_SECRET_KEY` ← **필수**

---

## 🧪 GitHub Actions 테스트

Secrets 추가 후 수동으로 워크플로우를 실행하여 테스트:

### 1. Actions 탭으로 이동

1. GitHub 저장소에서 **Actions** 탭 클릭
2. 좌측 메뉴에서 **"Weekly Stock Report"** 선택

### 2. 수동 실행

1. **"Run workflow"** 버튼 클릭
2. Branch: `main` 선택
3. **"Run workflow"** 확인

### 3. 실행 로그 확인

워크플로우 실행 후 로그에서 다음 메시지 확인:

```
💰 보유 종목 실시간 가격 수집 중...
🔄 Alpaca 실시간 가격 API 사용 중...
📊 최신 가격 조회 (REST): FSLR, PL, CSIQ
💰 FSLR: $245.78 (REGULAR)
💰 PL: $11.23 (REGULAR)
💰 CSIQ: $21.38 (REGULAR)
✅ 실시간 가격 조회 완료 - 현재 세션: POST
```

성공하면 실시간 가격 시스템이 GitHub Actions에서 정상 작동합니다! ✅

---

## ⚠️ 보안 주의사항

### GitHub Secrets의 안전성

- ✅ GitHub Secrets는 **암호화되어 저장**됩니다
- ✅ 워크플로우 로그에 **자동으로 마스킹**됩니다 (****로 표시)
- ✅ Pull Request에서는 **접근 불가능**합니다 (Fork 공격 방지)
- ✅ Repository 소유자와 Admin만 수정 가능

### Alpaca Paper Trading

- ✅ `ALPACA_PAPER=true`로 설정하면 **가상 거래**만 가능
- ✅ 실제 돈을 입금하지 않았으므로 **안전**
- ✅ 실시간 시장 데이터는 **무료**로 제공

---

## 🔄 자동 실행 일정

Secrets 설정 완료 후 다음 일정에 자동으로 실시간 가격이 사용됩니다:

### Weekly Agent Reports

- **일정**: 매주 금요일 22:00 UTC (토요일 07:00 KST)
- **워크플로우**: `.github/workflows/daily-report.yml`
- **실행 내용**: Claude, GPT, Gemini, Grok Agent 리포트 생성

### Manager Agent Report

- **일정**: 매주 금요일 22:30 UTC (토요일 07:30 KST)
- **워크플로우**: `.github/workflows/manager-report.yml`
- **실행 내용**: 4개 Agent 통합 분석 및 매매 추천

---

## 📞 문제 해결

### "Alpaca API 키가 설정되지 않았습니다" 오류

**원인**: GitHub Secrets에 `ALPACA_API_KEY` 또는 `ALPACA_SECRET_KEY`가 없음

**해결**:
1. GitHub Repository → Settings → Secrets and variables → Actions
2. 두 개의 Secret 추가 확인
3. 오타 없이 정확히 입력 (`ALPACA_API_KEY`, `ALPACA_SECRET_KEY`)

### "Unauthorized" 에러 (401)

**원인**: API 키가 잘못되었거나 만료됨

**해결**:
1. https://app.alpaca.markets 로그인
2. Paper Trading 계정 확인
3. API Keys → Regenerate
4. GitHub Secrets 업데이트

### "실시간 가격 조회 실패, Yahoo Finance fallback"

**원인**: Alpaca API 일시적 오류 (정상 동작)

**결과**:
- ℹ️ 자동으로 Yahoo Finance로 전환됨
- ℹ️ 일일 종가 사용 (실시간 가격 아님)
- ℹ️ 다음 실행 시 자동 복구

---

## ✅ 설정 완료 체크리스트

- [ ] Alpaca 계정 생성 (Paper Trading)
- [ ] API Key 발급 완료
- [ ] GitHub Secrets에 `ALPACA_API_KEY` 추가
- [ ] GitHub Secrets에 `ALPACA_SECRET_KEY` 추가
- [ ] 워크플로우 파일 수정 완료 (`.github/workflows/*.yml`)
- [ ] 수동 실행으로 테스트 완료
- [ ] 로그에서 "실시간 가격 조회 완료" 확인

모든 항목 완료 시 **실시간 주식 가격 시스템**이 GitHub Actions에서 자동으로 작동합니다! 🎉

---

**마지막 업데이트**: 2025-11-21
**작성자**: Claude Code
