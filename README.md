# 🚀 NASDAQ AutoTrader - Multi-Agent AI 투자 시스템

**4개의 AI Agent가 협력하여 포트폴리오를 관리하는 완전 자동화 투자 시스템**

- **Agent_GPT**: OpenAI GPT-5로 체계적인 투자 분석
- **Agent_Gemini**: Google Gemini로 빠른 시장 트렌드 분석  
- **Agent_Claude**: Anthropic Claude로 심층적인 리스크 분석
- **Manager_Agent**: 3개 Agent 보고서를 통합하여 최종 매매 결정

## 🎯 프로젝트 개요

현재 **₩295만원 포트폴리오**를 **1년 내 ₩1,000만원 (260% 성장)**으로 달성하기 위한 **Multi-Agent AI 투자 시스템**입니다.

### ✨ 핵심 특징
- 🤖 **4개 AI Agent 협력**: GPT-5, Gemini, Claude + Manager Agent
- 📊 **실시간 포트폴리오 추적**: 현금/보유종목 독립 관리
- 📧 **주간 리포트**: 매주 월요일 오후 3시 자동 발송 
- 💰 **간편 매매 시스템**: 명령어 한 줄로 매수/매도
- 🔒 **안전 보장**: 매도량 검증 및 데이터 무결성 보호

## 🏗️ Multi-Agent 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                   Weekly Scheduler                         │
│                  (매주 월요일 15:00)                        │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│              Data Collection Engine                         │
│         - 주식 스크리닝 및 뉴스 수집                        │
│         - 포트폴리오 현황 계산                              │
│         - 시장 데이터 분석                                  │
└─────────────┬──────────┬──────────┬─────────────────────────┘
              │          │          │
        ┌─────▼────┐ ┌───▼────┐ ┌───▼────┐
        │Agent_GPT │ │Agent   │ │Agent   │
        │ (GPT-5)  │ │Gemini  │ │Claude  │
        └─────┬────┘ └───┬────┘ └───┬────┘
              │          │          │
        ┌─────▼──────────▼──────────▼─────┐
        │         Manager_Agent           │
        │    (3개 보고서 통합 분석)        │
        └─────────────┬───────────────────┘
                      │
        ┌─────────────▼───────────────────┐
        │       Email Delivery            │
        │   최종 매매 추천 리포트 발송     │
        └─────────────────────────────────┘
```

## 📁 프로젝트 구조

```
NASDAQ_AUTO/
├── src/
│   ├── jobs/
│   │   └── weekly.ts           # 주간 파이프라인
│   ├── services/
│   │   ├── llm.ts              # GPT-5 서비스
│   │   ├── gemini.ts           # Gemini 서비스
│   │   ├── claude.ts           # Claude 서비스
│   │   ├── manager.ts          # Manager Agent
│   │   ├── screening.ts        # 종목 스크리닝
│   │   ├── market.ts           # 시장 데이터
│   │   ├── mail.ts             # 이메일 발송
│   │   └── trading.ts          # 매매 시스템
│   ├── storage/
│   │   └── database.ts         # 데이터 관리
│   └── server/                 # 웹 대시보드
├── data/
│   ├── json/                   # 거래/현금 데이터
│   │   ├── trades.json         # 모든 매매 기록
│   │   └── cash_events.json    # 현금 입출금 기록
│   └── report/                 # 생성된 리포트
├── tools/                      # 매매 관리 도구
│   ├── add-trade.js            # 간편 매매 입력
│   ├── check-balance.js        # 현금 잔고 확인
│   ├── calculate-portfolio-value.js
│   └── test-manager-only.js    # Manager Agent 테스트
├── docs/                       # 문서
│   ├── TRADING-GUIDE.md        # 매매 시스템 가이드
│   └── DANGER-ZONE.md          # 안전 지침
└── prompts/                    # AI 프롬프트
    ├── prompt.md               # Agent 프롬프트
    └── promptManagerSimple.md  # Manager Agent 프롬프트
```

## 🚀 빠른 시작

### 1. 환경 설정

```bash
# 프로젝트 클론
git clone https://github.com/kx2471/NASDAQ_AUTO.git
cd NASDAQ_AUTO

# 의존성 설치
npm install

# 환경 변수 설정 (.env 파일 생성)
OPENAI_API_KEY=your-openai-api-key
GEMINI_API_KEY=your-gemini-api-key  
CLAUDE_API_KEY=your-claude-api-key
RESEND_API_KEY=your-resend-api-key
MAIL_TO=your-email@example.com
ALPHAVANTAGE_API_KEY=your-alpha-vantage-key
NEWSAPI_API_KEY=your-news-api-key

# 데이터베이스 설정 (현재 JSON 파일 기반)
ENABLE_SUPABASE_MIGRATION=false
```

### 2. 시스템 실행

```bash
# TypeScript 빌드
npm run build

# Manager Agent 테스트
node tools/test-manager-only.js

# 웹 대시보드 실행
npm start
```

## 💰 매매 시스템 사용법

### 간편 매매 명령어

```bash
# 매수
node tools/add-trade.js BUY AAPL 5 180.50 "애플 추가매수"

# 매도
node tools/add-trade.js SELL NVDA 1 185.00 "일부 익절"

# 현금 잔고 확인
node tools/check-balance.js

# 포트폴리오 가치 계산
node tools/calculate-portfolio-value.js

# 도움말
node tools/add-trade.js --help
```

### 안전 기능
- ✅ **매도량 검증**: 보유량 초과 매도 자동 차단
- ✅ **입력 검증**: 잘못된 수량/가격 입력 방지
- ✅ **자동 ID 생성**: 거래 기록 관리 자동화

## 🤖 Multi-Agent 분석 시스템

### 1. Agent_GPT (OpenAI GPT-5)
- **특징**: 체계적이고 정량적인 투자 분석
- **강점**: 복합 데이터 해석 및 매매 타이밍
- **출력**: 상세한 수익률 계산 및 리스크 분석

### 2. Agent_Gemini (Google Gemini)
- **특징**: 빠르고 효율적인 시장 분석
- **강점**: 실시간 트렌드 파악 및 모멘텀 분석
- **출력**: 간결하고 실용적인 투자 전략

### 3. Agent_Claude (Anthropic Claude)
- **특징**: 심층적이고 보수적인 분석
- **강점**: 리스크 관리 및 장기적 관점
- **출력**: 균형잡힌 포트폴리오 제안

### 4. Manager_Agent (통합 관리자)
- **역할**: 3개 Agent 보고서 종합 분석
- **특징**: 최종 매매 결정 및 현금 관리
- **출력**: 실행 가능한 구체적 매매 지시

## 📊 현재 포트폴리오 (2025-09-15)

### 보유 현황
- **현금**: $90.01 (₩125,273)
- **보유종목**:
  - BABA: 1주 (평단 $154.40)
  - GOOGL: 4.866031주 (평단 $240.46)
  - NVDA: 1.5주 (평단 $177.38) *0.5주 매도됨
  - COIN: 1주 (평단 $325.93)
- **총 가치**: 약 ₩295만원

### 투자 목표
- **목표 금액**: ₩10,000,000 (1년 내)
- **현재 달성률**: 29.5%
- **필요 성장률**: 260% (월평균 22%)

## 📧 자동화 시스템

### 주간 리포트 발송 (매주 월요일 15:00)
순서대로 발송되는 4개 이메일:
1. 🤖 **Agent_Claude 주간 리포트**
2. 🤖 **Agent_GPT 주간 리포트** 
3. 🤖 **Agent_Gemini 주간 리포트**
4. 🏢 **Manager_Agent 최종 통합 리포트**

### 리포트 내용
- **성과 추적**: 목표 달성률 및 수익률 분석
- **포트폴리오 현황**: 보유종목별 평가 및 수익률
- **매매 의견**: 구체적인 매수/매도 추천
- **신규 추천**: 고성장 기대 종목 발굴
- **시장 동향**: 섹터별 트렌드 분석

## 🔧 개발 및 관리

### NPM 스크립트
```bash
npm run dev          # 개발 서버 실행
npm run build        # TypeScript 빌드  
npm run start        # 프로덕션 실행 (웹 대시보드)
npm run typecheck    # 타입 체크
npm run lint         # 코드 린트
```

### 테스트 및 검증
```bash
# Manager Agent 단독 테스트
node tools/test-manager-only.js

# 현금 잔고 검증
node tools/check-balance.js

# 포트폴리오 가치 계산
node tools/calculate-portfolio-value.js

# 매매 기능 테스트
node tools/add-trade.js BUY TEST 1 100 "테스트"
```

## 🔒 보안 및 안정성

### 데이터 보호
- **JSON 파일 기반**: Supabase 비활성화로 안전한 로컬 운영
- **백업 시스템**: 중요 거래 전 자동 백업
- **입력 검증**: 모든 매매 입력에 대한 검증 로직

### 안전장치
- **DANGER-ZONE.md**: 데이터 무결성 보호 가이드
- **매도량 검증**: 보유량 초과 매도 방지
- **하드코딩 방지**: 동적 데이터 사용 강제

## 📚 관련 문서

- **[TRADING-GUIDE.md](./docs/TRADING-GUIDE.md)**: 완전한 매매 시스템 가이드
- **[DANGER-ZONE.md](./docs/DANGER-ZONE.md)**: 데이터 안전 및 무결성 지침  
- **[CLAUDE.md](./CLAUDE.md)**: Claude Code 개발자를 위한 가이드

## 🛠️ 기술 스택

### Backend
- **Runtime**: Node.js + TypeScript
- **Database**: JSON 파일 (Supabase 대체)
- **APIs**: Alpha Vantage, NewsAPI
- **Email**: Resend API

### AI Models
- **OpenAI**: GPT-5 (gpt-5)
- **Google**: Gemini 2.5 Flash
- **Anthropic**: Claude Opus 4.1

### Infrastructure
- **Development**: 로컬 환경
- **Scheduling**: Node-cron (주간 실행)
- **Monitoring**: 웹 대시보드

## 🚨 면책사항

본 시스템은 투자 참고용으로만 제작되었으며, 투자자문이 아닙니다.
- AI 분석 결과는 참고용이며 투자 손실에 대한 책임은 사용자에게 있습니다
- 실제 투자 결정은 개인의 판단과 책임하에 이루어져야 합니다
- 시장 변동성 및 API 장애 등으로 인한 서비스 중단 가능성이 있습니다

## 📞 문의 및 지원

- **GitHub Issues**: 버그 리포트 및 기능 요청
- **프로젝트 저장소**: [https://github.com/kx2471/NASDAQ_AUTO](https://github.com/kx2471/NASDAQ_AUTO)
- **이메일**: kx2471@gmail.com

---

## 🎯 **Multi-Agent AI 투자 시스템 완성!**

### ✅ 주요 달성 사항:
- **4개 AI Agent**: GPT-5, Gemini, Claude + Manager Agent
- **완전 자동화**: 주간 리포트 및 매매 추천 시스템
- **간편 매매**: 명령어 한 줄로 매수/매도 처리
- **안전 보장**: 데이터 무결성 및 매도량 검증 
- **실시간 추적**: 현금/보유종목 독립 관리

**현재 진행률**: 27.5% (₩2,750,000/₩10,000,000)  
**다음 목표**: Multi-Agent 협력으로 최적 투자 전략 실행! 🚀

**최종 업데이트**: 2025-09-15  
**버전**: Multi-Agent System v1.0