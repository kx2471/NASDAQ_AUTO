# CLAUDE.md

이 파일은 Claude Code (claude.ai/code)가 이 저장소의 코드로 작업할 때 지침을 제공합니다.

## 프로젝트 개요

**Nasdaq AutoTrader** - AI 기반 주식 자동 분석 및 리포트 시스템입니다.

### 핵심 기능
- **Multi-Agent 시스템**: GPT-5, Gemini, Claude, Grok 4개 AI Agent + Manager Agent
- **주간 리포트**: 매주 월요일 오후 3시 자동 발송
- **매매 관리**: 간편한 매수/매도 입력 및 추적
- **포트폴리오 추적**: 실시간 현금/보유종목 관리
- **웹 대시보드**: 포트폴리오 현황 시각화

## 현재 상태 (2025-09-15)

### 기술 스택
- **Backend**: Node.js + TypeScript
- **Database**: JSON 파일 기반 (Supabase 비활성화 상태)
- **AI Models**: OpenAI GPT-5, Google Gemini, Anthropic Claude
- **Email**: Resend API
- **Deployment**: 로컬 개발 환경

### 프로젝트 구조
```
├── src/
│   ├── jobs/           # 스케줄링 작업 (주간 리포트)
│   ├── services/       # 핵심 서비스 (LLM, 매매, 이메일)
│   ├── storage/        # 데이터 관리
│   └── server/         # 웹 서버
├── tools/              # 매매 관리 도구
│   ├── add-trade.js    # 간편 매매 입력
│   ├── check-balance.js # 현금 잔고 확인
│   └── test-manager-only.js # Manager Agent 테스트
├── docs/               # 문서
│   ├── TRADING-GUIDE.md # 매매 시스템 가이드
│   └── DANGER-ZONE.md  # 안전 지침
├── prompts/            # AI 프롬프트
│   ├── prompt.md       # Agent 프롬프트
│   └── promptManagerSimple.md # Manager Agent 프롬프트
└── data/
    ├── json/           # 거래/현금 데이터
    └── report/         # 생성된 리포트
```

### 현재 포트폴리오 (2025-09-15 기준)
- **현금**: $90.01 (₩125,273)
- **보유종목**: BABA(1주), GOOGL(4.87주), NVDA(1.5주), COIN(1주)
- **총 가치**: 약 ₩295만원

## 개발 환경

### 필수 환경 변수
```env
# LLM APIs
OPENAI_API_KEY=sk-proj-...
GEMINI_API_KEY=AIzaSy...
CLAUDE_API_KEY=sk-ant-...
GROK_API_KEY=xai-...

# Email
RESEND_API_KEY=re_...
MAIL_TO=your-email@gmail.com

# Database (현재 비활성화)
ENABLE_SUPABASE_MIGRATION=false
```

### 개발 명령어
```bash
# 개발 서버 실행
npm run dev

# 빌드
npm run build

# 프로덕션 실행
npm start

# 타입 체크
npm run typecheck

# 린트
npm run lint
```

## 매매 시스템 사용법

### 간편 매매 명령어
```bash
# 매수
node add-trade.js BUY AAPL 5 180.50 "메모"

# 매도
node add-trade.js SELL NVDA 1 185.00 "익절"

# 현금 잔고 확인
node check-balance.js

# 포트폴리오 가치 계산
node calculate-portfolio-value.js
```

### Manager Agent 테스트
```bash
# 통합 리포트 생성 및 이메일 발송
node test-manager-only.js
```

## 아키텍처 특징

### Multi-Agent 시스템
1. **Agent_Claude**: 기술적 분석 중심
2. **Agent_GPT**: 종합적 시장 분석 (GPT-5 사용)
3. **Agent_Gemini**: 뉴스 및 센티먼트 분석
4. **Agent_Grok**: 독창적인 시장 인사이트 (xAI Grok 사용)
5. **Manager_Agent**: 4개 Agent 보고서 통합 및 최종 매매 결정

### 데이터 관리
- **현금 잔고**: `data/json/cash_events.json` - 입출금 기록
- **거래 내역**: `data/json/trades.json` - 모든 매수/매도 기록
- **독립 관리**: 현금과 보유종목이 별도로 추적됨

### 안전 장치
- **매도량 검증**: 보유량 초과 매도 방지
- **하드코딩 방지**: `DANGER-ZONE.md` 안전 지침
- **데이터 백업**: JSON 파일 기반 안전한 운영

## 코딩 규칙

### TypeScript 스타일
- 모든 함수와 메서드에는 **한글 주석** 작성
- 함수의 목적, 매개변수, 반환값 명확히 설명
- interface 정의 시 용도별 분리

### 파일 구조
- **services/**: 비즈니스 로직
- **storage/**: 데이터 접근 계층
- **jobs/**: 스케줄링 작업
- **server/**: API 엔드포인트

## 문서화 규칙

### 필수 문서들
- `TRADING-GUIDE.md`: 매매 시스템 완전 가이드
- `DANGER-ZONE.md`: 데이터 안전 지침
- `README.md`: 프로젝트 개요 및 설정

### 새 기능 추가 시
1. **기능 구현** 후 관련 문서 업데이트
2. **테스트 스크립트** 작성
3. **README.md**에 사용법 추가
4. **안전성 검토** 후 DANGER-ZONE.md 업데이트

## 주요 변경 이력

### 2025-09-15: 완전한 매매 시스템 구축
- ✅ Multi-Agent 시스템 구현 (GPT-5, Gemini, Claude, Grok + Manager)
- ✅ 매매 입력 자동화 (`add-trade.js`)
- ✅ 현금 잔고 추적 시스템
- ✅ 데이터 무결성 보호 (하드코딩 방지)
- ✅ 주간 리포트 이메일 발송 (월요일 3PM)
- ✅ Grok Agent 추가 (xAI Grok-beta 모델)

### 주요 수정사항
- **이메일 발송 순서**: Claude → GPT-5 → Gemini → Grok
- **Manager Agent 구조 개선**: 4개 Agent 보고서 통합 분석
- **토큰 한도 최적화**: GPT-5 15,000 토큰
- **Supabase 비활성화**: JSON 기반 안전한 운영
- **Grok 통합**: xAI API 연동 및 독립적인 시장 분석

## 주의사항

### 데이터 안전
1. **매매 데이터 수정 금지**: 직접 JSON 편집 시 백업 필수
2. **하드코딩 금지**: 수량/가격은 사용자 입력 또는 API에서 가져오기
3. **검증 후 실행**: 모든 스크립트는 테스트 환경에서 검증 후 적용

### LLM 사용 시
1. **모델 변경 금지**: 검증 중 API나 모델 임의 변경 안 함
2. **토큰 수 보고**: 실제 사용 토큰 수 사용자에게 알림
3. **환경 일관성**: 동일 조건에서만 검증 수행

### 시스템 운영
1. **Manager Agent 우선**: 매매 결정은 Manager Agent 추천 기반
2. **현금 한도 준수**: 가용 현금 범위 내에서만 매수
3. **정기 백업**: 중요 거래 전 데이터 백업

## 문제 발생 시 대응

### 데이터 오류
1. **즉시 작업 중단**
2. **백업 파일로 복원**
3. **DANGER-ZONE.md** 참고하여 원인 분석
4. **안전장치 강화** 후 재적용

### 매매 오류
1. **add-trade.js** 검증 기능 활용
2. **check-balance.js**로 결과 확인
3. **Manager Agent** 재실행으로 상태 동기화

---

**최종 업데이트**: 2025-09-15  
**현재 버전**: 완전한 매매 시스템 v1.0  
**개발 환경**: Windows + Node.js + TypeScript