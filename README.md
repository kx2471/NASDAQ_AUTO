# 🚀 NASDAQ AUTO - 3개 AI 통합 투자 분석 시스템

**3개의 AI가 각각 다른 관점으로 투자 전략을 제시하는 자동화 시스템**

- **GPT-5**: OpenAI의 최신 모델로 체계적인 투자 분석
- **Gemini 2.5 Flash**: Google AI의 빠르고 정확한 시장 분석  
- **Claude Opus 4.1**: Anthropic의 심층적인 전략 수립

## 🎯 프로젝트 개요

현재 278만원 포트폴리오를 **1년 내 1000만원 (360% 성장)**으로 만들기 위한 **3개 AI 통합 분석 시스템**입니다.

### ✨ 핵심 특징
- 🤖 **3개 AI 독립 분석**: GPT-5, Gemini 2.5 Flash, Claude Opus 4.1
- 📊 **실시간 기술지표**: RSI14, EMA20, EMA50 자동 계산
- 📧 **개별 이메일 발송**: 각 AI가 독립적인 리포트 생성
- 🔄 **자동화 시스템**: 매일 16시 GitHub Actions 실행
- 💰 **1000만원 목표**: 월평균 30-50% 성장 전략

## 🏗️ 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                   GitHub Actions Scheduler                  │
│                    (매일 16:00 KST)                         │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                Stock Screening Engine                       │
│         - 45개 종목 기술지표 계산                           │
│         - Alpha Vantage & NewsAPI 데이터 수집               │
│         - AI & ML, Cloud, Nuclear 섹터 분석                 │
└─────────────┬──────────┬──────────┬─────────────────────────┘
              │          │          │
        ┌─────▼────┐ ┌───▼────┐ ┌───▼────┐
        │  GPT-5   │ │ Gemini │ │ Claude │
        │ Analysis │ │ 2.5 F  │ │Opus4.1 │
        └─────┬────┘ └───┬────┘ └───┬────┘
              │          │          │
        ┌─────▼────┐ ┌───▼────┐ ┌───▼────┐
        │Report #1 │ │Report#2│ │Report#3│
        └─────┬────┘ └───┬────┘ └───┬────┘
              │          │          │
        ┌─────▼──────────▼──────────▼─────┐
        │         Email Service           │
        │      3개 독립 리포트 발송        │
        └─────────────────────────────────┘
```

## 📁 프로젝트 구조

```
NASDAQ_AUTO/
├── src/
│   ├── jobs/
│   │   └── daily.ts           # 메인 파이프라인 (3개 AI 통합)
│   ├── services/
│   │   ├── llm.ts             # GPT-5 서비스
│   │   ├── gemini.ts          # Gemini 2.5 Flash 서비스
│   │   ├── claude.ts          # Claude Opus 4.1 서비스
│   │   ├── screening.ts       # 종목 스크리닝 엔진
│   │   ├── market.ts          # 시장 데이터 수집
│   │   └── mail.ts            # 이메일 발송 서비스
│   ├── storage/
│   │   └── database.ts        # JSON 파일 데이터베이스
│   └── utils/
├── config/
│   └── sectors.yaml           # 섹터별 종목 설정
├── data/
│   ├── json/                  # 포트폴리오 & 종목 데이터
│   └── report/                # 생성된 리포트 파일
├── .github/workflows/
│   └── daily-report.yml       # 자동화 스케줄러
├── prompt.md                  # 통합 AI 프롬프트
└── manual-test.js             # 수동 테스트 스크립트
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
```

### 2. 시스템 빌드 및 실행

```bash
# TypeScript 컴파일
npm run build

# 수동 테스트 (3개 AI 리포트 생성)
node manual-test.js

# 개발 서버 실행  
npm run dev
```

## 🤖 3개 AI 분석 시스템

### 1. GPT-5 (OpenAI)
- **특징**: 체계적이고 구조화된 투자 분석
- **강점**: 복합적 데이터 해석 및 리스크 관리
- **출력**: 상세한 매매 계획과 손익 계산

### 2. Gemini 2.5 Flash (Google AI)  
- **특징**: 빠르고 효율적인 시장 분석
- **강점**: 실시간 데이터 처리 및 트렌드 파악
- **출력**: 간결하고 실용적인 투자 전략

### 3. Claude Opus 4.1 (Anthropic)
- **특징**: 심층적이고 보수적인 분석 접근
- **강점**: 리스크 분석 및 장기적 관점
- **출력**: 균형잡힌 투자 포트폴리오 제안

## 📊 분석 대상 종목

### 섹터별 구성
- **AI & Machine Learning**: 11개 종목 (GOOGL, META, NVDA 등)
- **Cloud & Computing**: 15개 종목 (MSFT, AMZN, CRM 등) 
- **Nuclear & Clean Energy**: 19개 종목 (TSLA, NIO, PLTR 등)

### 기술지표 분석
- **RSI14**: 과매수/과매도 신호
- **EMA20/EMA50**: 추세 방향 및 정배열 확인
- **가격 모멘텀**: 단기 및 장기 모멘텀 분석

## 📧 자동화 시스템

### GitHub Actions 스케줄
```yaml
# 매일 평일 16:00 KST (07:00 UTC) 실행
schedule:
  - cron: '0 7 * * 1-5'
```

### 이메일 리포트 발송
매일 3개의 독립적인 이메일이 발송됩니다:
1. 🤖 **GPT-5 통합 데일리 리포트**
2. 🤖 **Gemini Pro 통합 데일리 리포트**  
3. 🤖 **Claude 통합 데일리 리포트**

## 🔧 API 및 설정

### 필수 환경 변수
```bash
# AI 서비스
OPENAI_API_KEY=sk-proj-...
GEMINI_API_KEY=AIzaSy...
CLAUDE_API_KEY=sk-ant-api03-...

# 데이터 공급자
ALPHAVANTAGE_API_KEY=your-key
NEWSAPI_API_KEY=your-key

# 이메일 서비스
RESEND_API_KEY=re_...
MAIL_TO=user@example.com

# 모델 설정
LLM_MODEL=gpt-5
GEMINI_MODEL=gemini-2.5-flash
CLAUDE_MODEL=claude-opus-4-1-20250805
ENABLE_GEMINI_REPORT=true
```

### API 엔드포인트
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /v1/health | 서버 상태 확인 |
| POST | /v1/run/daily | 수동으로 데일리 파이프라인 실행 |
| GET | /v1/trades | 거래 기록 조회 |
| POST | /v1/trades | 거래 기록 추가 |

## 📈 리포트 내용

### 공통 구조 (통합 prompt.md 기반)
1. **성과 추적**: 현재 포트폴리오 성과 및 목표 달성률
2. **포트폴리오 현황**: 보유 종목별 수익률 및 평가액
3. **매매 의견**: 보유 종목에 대한 구체적 매매 전략
4. **고성장 추천 종목**: 신규 투자 대상 및 진입 전략
5. **시장 동향**: 섹터별 트렌드 및 이슈 분석
6. **후속 트래킹 계획**: 주간/월간 리밸런싱 일정

### 각 AI별 차별화된 관점
- **GPT-5**: 데이터 기반 정량적 분석 중심
- **Gemini**: 시장 트렌드 및 모멘텀 분석 강화
- **Claude**: 리스크 관리 및 보수적 접근 강조

## 🛠️ 개발 및 관리

### NPM 스크립트
```bash
npm run dev        # 개발 서버 실행
npm run build      # TypeScript 빌드  
npm run start      # 프로덕션 실행
```

### 수동 테스트
```bash
# 3개 AI 리포트 테스트
node manual-test.js

# 환경 변수 확인
node -e "require('dotenv').config(); console.log('API Keys:', {openai: !!process.env.OPENAI_API_KEY, gemini: !!process.env.GEMINI_API_KEY, claude: !!process.env.CLAUDE_API_KEY})"
```

### 프로젝트 관리
- **코딩 규칙**: 모든 함수에 한글 주석 필수
- **문서화**: 새 기능 추가시 README 업데이트
- **에러 처리**: 모든 AI 호출에 fallback 시스템 구현
- **보안**: API 키는 반드시 환경변수로 관리

## 🔒 보안 및 안정성

### Fallback 시스템
각 AI 서비스는 3-tier fallback 시스템을 구현:
- **Retry Logic**: 최대 3번 재시도 (exponential backoff)
- **Model Fallback**: 메인 모델 실패시 대체 모델 사용
- **Error Handling**: API 장애시 기본 리포트 생성

### 데이터 보안
- 모든 민감정보는 환경변수로 관리
- GitHub Secrets를 통한 CI/CD 보안
- API 호출 로그에서 키 정보 마스킹

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

## 🎯 **3개 AI 통합 시스템 완성!**

### ✅ 주요 달성 사항:
- **3개 AI 엔진**: GPT-5, Gemini 2.5 Flash, Claude Opus 4.1
- **독립적 분석**: 각 AI가 서로 다른 관점으로 투자 전략 제시  
- **완전 자동화**: 매일 16시 자동 실행 및 이메일 발송
- **통합 데이터**: 동일한 시장 데이터로 공정한 비교 분석
- **Fallback 시스템**: 안정적인 서비스 운영 보장

**현재 진행률**: 27.77% (₩2,780,874/₩10,000,000)  
**다음 목표**: 3개 AI 관점을 활용한 최적 투자 전략 실행! 🚀