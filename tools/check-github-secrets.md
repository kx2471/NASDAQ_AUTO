# GitHub Actions 실패 진단 가이드

## 🔧 필수 Secrets 체크리스트

GitHub Repository → Settings → Secrets and variables → Actions에서 다음 항목들이 모두 설정되어 있는지 확인:

### Alpaca API (실시간 가격 조회)
- [ ] `ALPACA_API_KEY` - ✅ 필수
- [ ] `ALPACA_SECRET_KEY` - ✅ 필수

### LLM APIs
- [ ] `OPENAI_API_KEY` - GPT Agent
- [ ] `GEMINI_API_KEY` - Gemini Agent
- [ ] `CLAUDE_API_KEY` - Claude Agent
- [ ] `GROK_API_KEY` - Grok Agent

### Manager Model (새로 추가)
- [ ] `MANAGER_MODEL` - 예: `claude-opus-4-5-20251101`

### 기타
- [ ] `RESEND_API_KEY` - 이메일 발송
- [ ] `MAIL_TO` - 수신자 이메일

---

## 🐛 일반적인 실패 원인

### 1. Alpaca API 관련 에러

**증상**: "Alpaca API 키가 설정되지 않았습니다" 또는 "401 Unauthorized"

**원인**:
- GitHub Secrets에 `ALPACA_API_KEY` 또는 `ALPACA_SECRET_KEY`가 없음
- API 키가 잘못 입력됨 (앞뒤 공백, 오타)
- Alpaca Paper Trading 계정이 비활성화됨

**해결**:
```bash
# GitHub Secrets 재확인
1. https://github.com/kx2471/NASDAQ_AUTO/settings/secrets/actions
2. ALPACA_API_KEY = PK4BWQZSGPZLRJEPOTNGNOAZK6
3. ALPACA_SECRET_KEY = 31DLL7WmZGp7frMMfmwsvgAUfksy85PYdCyh5RcTRErE
```

### 2. API Rate Limit 초과

**증상**: "429 Too Many Requests" 또는 타임아웃

**원인**:
- Alpaca 무료 티어는 분당 200 요청 제한
- 여러 워크플로우가 동시에 실행되어 제한 초과

**해결**:
- 워크플로우 실행 간격 조정
- 캐싱 사용 (이미 구현됨)
- 실패 시 재시도 로직 추가

### 3. 네트워크 타임아웃

**증상**: "getaddrinfo ENOTFOUND" 또는 "ETIMEDOUT"

**원인**:
- GitHub Actions 러너에서 Alpaca API 서버에 연결 실패
- 일시적인 네트워크 문제

**해결**:
- 워크플로우 재실행
- 타임아웃 설정 증가 (이미 60초로 설정됨)

### 4. 빌드 실패

**증상**: "tsc" 컴파일 에러

**원인**:
- TypeScript 타입 에러
- 의존성 패키지 문제

**해결**:
```bash
# 로컬에서 먼저 확인
npm run build
npm run typecheck
```

### 5. Manager Model 설정 누락

**증상**: "MANAGER_MODEL 환경변수가 설정되지 않았습니다"

**원인**:
- GitHub Secrets에 `MANAGER_MODEL`이 추가되지 않음

**해결**:
```bash
# GitHub Secrets 추가
Name: MANAGER_MODEL
Value: claude-opus-4-5-20251101
```

---

## 📊 GitHub Actions 로그 확인 방법

### 웹에서 확인
1. https://github.com/kx2471/NASDAQ_AUTO/actions
2. 실패한 워크플로우 클릭
3. 실패한 Job 클릭
4. 에러 메시지 확인

### 특정 에러 패턴 찾기

#### Alpaca API 에러
```
❌ Alpaca API 키가 설정되지 않았습니다
❌ 실시간 가격 조회 실패
⚠️ Alpaca 웹소켓 에러
```

#### LLM API 에러
```
❌ CLAUDE_API_KEY 환경변수가 설정되지 않았습니다
❌ OpenAI API로부터 빈 응답
❌ Anthropic API 호출 실패
```

#### 기타
```
Error: Process completed with exit code 1
npm ERR!
git push failed
```

---

## 🔄 트러블슈팅 단계

### Step 1: Secrets 재확인
모든 필수 Secrets가 설정되어 있는지 확인

### Step 2: 로컬 테스트
```bash
# 로컬에서 동일한 환경 재현
npm run build
node tools/test-alpaca-realtime.js
node tools/test-manager-only.js
```

### Step 3: 워크플로우 수동 실행
GitHub Actions → Weekly Stock Report → Run workflow

### Step 4: 로그 분석
실패한 Step의 로그를 자세히 확인

### Step 5: 재시도
일시적인 네트워크 문제일 수 있으므로 Re-run failed jobs

---

## 💡 예방 조치

### 1. 환경변수 검증 스크립트
```javascript
// GitHub Actions에서 실행 전 환경변수 확인
console.log('Required secrets check:');
console.log('ALPACA_API_KEY:', !!process.env.ALPACA_API_KEY ? '✅' : '❌');
console.log('ALPACA_SECRET_KEY:', !!process.env.ALPACA_SECRET_KEY ? '✅' : '❌');
console.log('CLAUDE_API_KEY:', !!process.env.CLAUDE_API_KEY ? '✅' : '❌');
console.log('MANAGER_MODEL:', process.env.MANAGER_MODEL || '❌ Not set');
```

### 2. Fallback 메커니즘
- Alpaca 실패 시 Yahoo Finance로 자동 전환 (이미 구현됨)
- API 호출 재시도 로직 (이미 구현됨)

### 3. 알림 설정
- GitHub Actions 실패 시 이메일 알림 활성화
- Slack/Discord 웹훅 연동 고려

---

## 📞 추가 도움이 필요하면

1. GitHub Actions 로그 전체 복사
2. 실패한 Step 이름 확인
3. 에러 메시지 전체 확인

**마지막 업데이트**: 2025-11-26
