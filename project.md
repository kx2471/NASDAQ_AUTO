# 📊 3개 AI 통합 투자 분석 시스템 - 기술 명세서

> **목표**: GPT-5, Gemini 2.5 Flash, Claude Opus 4.1 **3개 AI가 독립적으로** 동일한 시장 데이터를 기반으로 **각각 다른 관점의 투자 분석 리포트**를 생성하는 자동화 시스템 구축

---

## 🎯 시스템 개요

### 핵심 특징
- **3개 AI 독립 분석**: 각각 서로 다른 접근 방식으로 투자 전략 제시
- **통합 데이터 소스**: 동일한 시장 데이터로 공정한 비교 분석 가능
- **완전 자동화**: GitHub Actions으로 매일 16시 자동 실행
- **개별 이메일 발송**: 각 AI 리포트를 별도 이메일로 발송

### AI별 특화 영역
| AI 모델 | 특징 | 분석 강점 | 출력 스타일 |
|---------|------|-----------|-------------|
| **GPT-5** | 체계적 분석 | 정량적 데이터 해석, 리스크 관리 | 상세한 매매 계획 |
| **Gemini 2.5 Flash** | 빠른 분석 | 실시간 트렌드, 모멘텀 분석 | 간결한 실행 전략 |
| **Claude Opus 4.1** | 심층 분석 | 장기적 관점, 보수적 접근 | 균형잡힌 포트폴리오 |

---

## 🏗️ 시스템 아키텍처

```
GitHub Actions (KST 16:00)
    │
    ▼
┌─────────────────────────────────────┐
│     Stock Screening Engine          │
│   - 45개 종목 동시 분석             │
│   - Alpha Vantage 가격/지표 수집     │
│   - NewsAPI 감성 분석               │
│   - 섹터별 스크리닝 (AI/Cloud/Nuclear) │
└─────────────┬───────────────────────┘
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
┏━━━━━━━┓ ┏━━━━━━━┓ ┏━━━━━━━┓
┃ GPT-5 ┃ ┃Gemini ┃ ┃Claude ┃
┃Analysis┃ ┃ 2.5F  ┃ ┃Opus4.1┃
┗━━━┯━━━┛ ┗━━━┯━━━┛ ┗━━━┯━━━┛
    │         │         │
    ▼         ▼         ▼
┌───────┐ ┌───────┐ ┌───────┐
│Report1│ │Report2│ │Report3│
│.md    │ │.md    │ │.md    │
└───┬───┘ └───┬───┘ └───┬───┘
    │         │         │
    ▼         ▼         ▼
┌─────────────────────────────────────┐
│         Resend Email Service        │
│        3개 독립 리포트 발송          │
└─────────────────────────────────────┘
```

---

## 📁 프로젝트 구조

```
NASDAQ_AUTO/
├── src/
│   ├── jobs/
│   │   └── daily.ts              # 메인 파이프라인 (3개 AI 통합)
│   ├── services/
│   │   ├── llm.ts                # GPT-5 서비스
│   │   ├── gemini.ts             # Gemini 2.5 Flash 서비스  
│   │   ├── claude.ts             # Claude Opus 4.1 서비스
│   │   ├── screening.ts          # 동적 종목 스크리닝
│   │   ├── market.ts             # 시장 데이터 & 기술지표
│   │   ├── news.ts               # 뉴스 수집 & 감성 분석
│   │   ├── mail.ts               # 이메일 발송
│   │   └── exchange.ts           # 환율 데이터
│   ├── storage/
│   │   └── database.ts           # JSON 파일 데이터베이스
│   ├── utils/
│   │   ├── config.ts             # 섹터 설정 로드
│   │   └── marketday.ts          # 미국 시장 휴장일 체크
│   └── server/
│       └── index.ts              # Express API 서버
├── config/
│   └── sectors.yaml              # 섹터별 종목 설정
├── data/
│   ├── json/                     # 포트폴리오 & 거래 데이터
│   └── report/                   # 생성된 리포트 파일
├── .github/workflows/
│   └── daily-report.yml          # 자동화 스케줄러
├── prompt.md                     # 통합 AI 프롬프트
├── manual-test.js                # 수동 테스트 스크립트
└── dist/                         # TypeScript 컴파일 결과
```

---

## 🔧 환경 변수 설정

### .env 파일 구조
```bash
# 서버 설정
PORT=8080
API_KEY=nasdaq-autotrader-secret-2025
NODE_ENV=production

# AI 서비스
OPENAI_API_KEY=sk-proj-...         # GPT-5
GEMINI_API_KEY=AIzaSy...           # Gemini 2.5 Flash
CLAUDE_API_KEY=sk-ant-api03-...    # Claude Opus 4.1

# 모델 설정
LLM_MODEL=gpt-5
GEMINI_MODEL=gemini-2.5-flash
CLAUDE_MODEL=claude-opus-4-1-20250805
ENABLE_GEMINI_REPORT=true

# 데이터 공급자
ALPHAVANTAGE_API_KEY=VQTVM6L87XL4ADTH
NEWSAPI_API_KEY=093577b0c7a449b6af8a06f0401ef578

# 이메일 서비스
MAIL_PROVIDER=RESEND
RESEND_API_KEY=re_Xwdamifo_AiDoQKTzSerLZCLZXJXKMLm
MAIL_TO=kx2471@gmail.com

# 스케줄링
REPORT_LOOKBACK_DAYS=30
MARKET_TZ=America/New_York
SEND_TZ=Asia/Seoul
SEND_HOUR_LOCAL=16
```

---

## 🤖 3개 AI 서비스 구현

### 1. GPT-5 서비스 (src/services/llm.ts)
```typescript
export async function generateReport(payload: any): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  const response = await client.chat.completions.create({
    model: 'gpt-5',
    messages: [
      { role: 'system', content: promptTemplate },
      { role: 'user', content: JSON.stringify(payload) }
    ],
    temperature: 0.7
  });
  
  return response.choices[0].message?.content || '';
}
```

### 2. Gemini 2.5 Flash 서비스 (src/services/gemini.ts)
```typescript
export async function generateReportWithGemini(...): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  // 3-tier fallback 시스템
  const models = [
    'gemini-2.5-flash',
    'gemini-1.5-flash-latest', 
    'gemini-2.0-flash'
  ];
  
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model, contents: prompt, 
        config: { temperature: 0.7, maxOutputTokens: 8192 }
      });
      return response.text;
    } catch (error) {
      // Retry logic with exponential backoff
    }
  }
}
```

### 3. Claude Opus 4.1 서비스 (src/services/claude.ts)
```typescript
export async function generateReportWithClaude(...): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-1-20250805',
    max_tokens: 8192,
    temperature: 0.7,
    messages: [{ role: 'user', content: prompt }]
  });
  
  return response.content[0]?.text || '';
}
```

---

## 📊 데이터 수집 & 분석 파이프라인

### 1. 동적 종목 스크리닝 (src/services/screening.ts)
```typescript
class DynamicStockScreener {
  async screenSector(sectorCode: string, config: any) {
    // 1. 기존 저장된 종목들 조회
    // 2. 품질 필터링 (활성 종목만 선별)
    // 3. 고품질 종목 검증 (시장 데이터 확인)
    // 4. 개별 종목 분석 (모멘텀, 뉴스 감성, 기술적 분석)
    // 5. 종합 점수 계산 및 추천 결정
  }
}
```

### 2. 시장 데이터 수집 (src/services/market.ts)
```typescript
export async function fetchDailyPrices(symbols: string[]) {
  // Alpha Vantage API를 통한 실시간 가격 수집
}

export function computeIndicators(closePrices: number[]) {
  // EMA20, EMA50, RSI14 계산
  return { ema20, ema50, rsi14 };
}
```

### 3. 뉴스 감성 분석 (src/services/news.ts)
```typescript
export async function fetchNews(options: {
  symbols: string[], sector: string, limit: number
}) {
  // NewsAPI를 통한 뉴스 수집 및 감성 점수 계산
}
```

---

## 📧 자동화 시스템

### GitHub Actions 스케줄 (.github/workflows/daily-report.yml)
```yaml
name: Daily Stock Report
on:
  schedule:
    - cron: '0 7 * * 1-5'  # 매일 KST 16:00
  workflow_dispatch:

jobs:
  generate-report:
    runs-on: ubuntu-latest
    steps:
      - name: Generate daily report
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          CLAUDE_API_KEY: ${{ secrets.CLAUDE_API_KEY }}
          # ... 기타 환경변수들
        run: |
          node -e "
          const { runDaily } = require('./dist/jobs/daily.js');
          runDaily().then(() => process.exit(0));
          "
```

### 메인 파이프라인 실행 순서 (src/jobs/daily.ts)
1. **미국 시장 휴장일 확인** - 휴장일이면 스킵
2. **섹터 설정 로드** - sectors.yaml에서 3개 섹터 로드
3. **전체 섹터 스크리닝** - 45개 종목 동적 발견 및 분석
4. **통합 데이터 준비** - 가격, 기술지표, 뉴스 수집
5. **3개 AI 병렬 분석**:
   - GPT-5 리포트 생성
   - Gemini 2.5 Flash 리포트 생성  
   - Claude Opus 4.1 리포트 생성
6. **파일 저장** - 각각 `unified_gpt5.md`, `unified_gemini.md`, `unified_claude.md`
7. **이메일 발송** - 3개 독립 이메일 발송

---

## 📈 통합 프롬프트 시스템

### prompt.md 구조
모든 AI가 동일한 프롬프트를 사용하여 일관성 있는 분석 제공:

```markdown
# 투자 리포트 생성 프롬프트

## 입력 데이터
- portfolio.holdings: 현재 보유 종목
- indicators: 기술지표 (RSI14, EMA20, EMA50)
- currentPrices: 현재가 정보
- market.exchange_rate: 환율 정보
- scores: 종목별 종합 점수
- news: 최신 뉴스 및 감성 분석

## 출력 구조
1. 성과 추적
2. 포트폴리오 현황 테이블
3. 매매 의견 (보유종목)
4. 고성장 추천 종목
5. 시장 동향
6. 후속 트래킹 계획

## 1000만원 달성 전략
- 현재 278만원 → 1년 내 1000만원 (360% 성장)
- 월평균 30-50% 성장 목표
- 과감한 회전 매매 전략
- 환율 리스크 고려
```

---

## 🔒 안정성 & 보안

### Fallback 시스템
각 AI 서비스는 3단계 안전장치 구현:

1. **Retry Logic**: 최대 3번 재시도 (exponential backoff)
2. **Model Fallback**: 메인 모델 실패시 대체 모델 사용
3. **Error Handling**: 모든 API 실패시 기본 리포트 생성

### 보안 조치
- 모든 API 키는 환경변수로 관리
- GitHub Secrets를 통한 CI/CD 보안
- API 호출 로그에서 민감정보 마스킹
- HTTPS 통신 및 CORS 설정

---

## 🧪 테스트 & 모니터링

### 수동 테스트 (manual-test.js)
```bash
node manual-test.js  # 3개 AI 리포트 동시 생성 테스트
```

### API 엔드포인트
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /v1/health | 시스템 상태 확인 |
| POST | /v1/run/daily | 수동 파이프라인 실행 |
| GET | /v1/trades | 거래 기록 조회 |
| POST | /v1/trades | 거래 기록 추가 |

### 성능 지표
- **종목 분석 수**: 45개 (AI/Cloud/Nuclear 섹터)
- **평균 실행 시간**: 5-8분 (3개 AI 병렬 처리)
- **이메일 발송**: 3개 독립 리포트 (각 8-12KB)
- **데이터 보존**: 30일 기간 분석 데이터 유지

---

## 📋 개발 & 배포

### NPM 스크립트
```bash
npm run build      # TypeScript 컴파일
npm run dev        # 개발 서버 실행  
npm start          # 프로덕션 서버 실행
```

### 배포 환경
- **GitHub Actions**: 자동화 스케줄러
- **Render/Vercel**: 서버 배포 (옵션)
- **JSON 파일 DB**: 로컬 파일 시스템 기반
- **Resend**: 이메일 발송 서비스

### 코딩 규칙
- 모든 함수에 한글 주석 필수
- TypeScript 엄격 모드 사용
- 에러 처리 및 로깅 표준화
- 환경변수 기반 설정 관리

---

## 🎯 성과 및 목표

### 현재 달성 사항
- ✅ 3개 AI 독립 분석 시스템 구축
- ✅ 45개 종목 동적 스크리닝 엔진
- ✅ 완전 자동화 파이프라인 (GitHub Actions)
- ✅ 통합 프롬프트 시스템으로 일관성 보장
- ✅ Fallback 시스템으로 안정성 확보

### 투자 목표
- **현재**: ₩2,780,874 (목표 달성률 27.77%)
- **목표**: 1년 내 ₩10,000,000 달성
- **전략**: 3개 AI 관점을 종합한 최적 투자 결정

### 기술적 확장성
- AI 모델 추가 용이한 모듈화 구조
- 섹터별 독립적 분석 및 확장 가능
- 실시간 데이터 처리 및 백테스팅 지원
- 다양한 알림 채널 확장 가능

---

## 🚨 면책사항 및 제한사항

### 투자 관련
- 본 시스템은 투자 참고용이며 투자자문이 아님
- AI 분석 결과에 대한 투자 손실 책임은 사용자에게 있음
- 시장 변동성으로 인한 예측 오차 가능성

### 기술적 제한사항
- 무료 API 쿼터 제한으로 인한 일시적 서비스 중단 가능
- AI 모델 API 장애시 fallback 리포트 제공
- 실시간 데이터가 아닌 일별 배치 처리

---

**🎯 3개 AI 통합 투자 분석 시스템 v3.0 완성!**

각기 다른 관점을 가진 3개의 AI가 동일한 데이터를 바탕으로 독립적인 투자 분석을 제공하는 혁신적인 자동화 시스템이 구축되었습니다.