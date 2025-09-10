# 📈 Stock-Report System – Full Build Spec (KST 16:00 + OpenAI GPT‑5)

> **Goal**: 매일 \*\*최신 뉴스 + 기술지표(EMA, RSI)\*\*를 수집·저장하고, **최근 N일(기본 30)** 데이터를 바탕으로 AI가 **매수/매도/보류 + 구체적 주문안**을 포함한 보고서를 생성. 사용자는 실제 거래를 하되, 거래/보유 현황을 DB에 기록하면 시스템이 보유수량/평단/현금 자동 갱신. 보고서는 **서버 업로드 + `/data/report` 저장 + 이메일 발송(한국시간 16:00, 나스닥 개장일에만)**.

---

## 0. 운영 개요

* **범위**: 나스닥 종목만 추적, 보고 **분야(sector)**(예: `ai`, `computing`, `nuclear`)는 사용자가 지정.
* **일일 루틴(영업일)**:

  1. 가격/지표(EMA, RSI) 갱신 → 2) 분야별 뉴스/감성 저장 → 3) 보유/현금 기반 주문 제안 → 4) **리포트 생성**(MD/HTML) → 5) 서버 업로드 + 로컬 `/data/report/` 저장 → 6) **이메일 발송(한국시간 16:00, 미개장일은 스킵)**
* **타임존**: 발송 기준 `Asia/Seoul`. 미국 시장 휴장/주말 여부는 서버에서 체크.

---

## 1. 기술 선택 (무료 우선 / 기본값)

**서버(HTTP API)**: Node.js + Express

* 배포: **Render Free Web Service**(기본) 또는 Vercel / Railway / Fly.io

**데이터베이스**: **JSON 파일 기반 저장소**

* 장점: 서버 의존성 없음, 단순한 구조, 백업/복원 용이

**이메일**: Resend(무료 개발 플랜) 또는 Nodemailer(SMTP: Gmail/NAVER)

**크론/스케줄러**: GitHub Actions(무료)로 서버 엔드포인트 호출(UTC 07:00 = KST 16:00)

**가격/지표/뉴스 공급자**: Alpha Vantage(지표/뉴스 감성), Yahoo Finance(비공식), Twelve Data, Finnhub(프리티어)

**LLM 보고서 생성**: **OpenAI GPT‑5(API)**

* `.env`: `LLM_PROVIDER=OPENAI`, `LLM_MODEL=gpt-5`, `OPENAI_API_KEY=`
* \*\*프롬프트는 리포지토리 최상위 `prompt.md`\*\*로 관리(시스템 프롬프트)

---

## 2. 리포지토리 구조

```
stock-report/
├─ /src
│  ├─ server/            # Express 서버
│  ├─ jobs/              # 크론 잡(수집/지표/뉴스/리포트/메일)
│  ├─ services/          # 데이터 공급자, LLM, 메일 등 추상화
│  ├─ storage/           # JSON 파일 저장소 관리
│  ├─ logic/             # 점수화/추천/리포트 템플릿
│  ├─ utils/             # 시간대/휴장일/로거/에러
│  └─ index.ts
├─ /config
│  ├─ sectors.yml        # 섹터별 키워드 및 설정
│  └─ providers.yml      # 데이터 공급자 설정
├─ /data
│  ├─ report/            # 생성 리포트(.md/.html)
│  └─ cache/             # 캐시(옵션)
├─ /scripts              # 수동 실행 스크립트
├─ .github/workflows
│  └─ scheduler.yml      # KST 16:00 트리거(UTC 07:00)
├─ prompt.md             # ▶︎ 시스템 프롬프트
├─ .env.example
├─ package.json
└─ README.md
```

---

## 3. 환경 변수 (.env)

```
# Server
PORT=8080
API_KEY=change_me
NODE_ENV=production
BASE_URL=https://<your-render-app>.onrender.com

# Storage (JSON 파일 기반)
# DATABASE_URL 불필요

# Data Providers
ALPHAVANTAGE_API_KEY=
FINNHUB_API_KEY=
NEWSAPI_API_KEY=

# LLM (OpenAI GPT-5)
LLM_PROVIDER=OPENAI
OPENAI_API_KEY=
LLM_MODEL=gpt-5

# Mail
MAIL_PROVIDER=RESEND     # or SMTP
RESEND_API_KEY=
SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
MAIL_FROM="Stock Report <noreply@yourdomain>"
MAIL_TO=han29181@naver.com

# Scheduling
REPORT_LOOKBACK_DAYS=30
MARKET_TZ=America/New_York
SEND_TZ=Asia/Seoul
SEND_HOUR_LOCAL=16
```

---

## 4. 데이터 구조 (JSON 파일 기반)

> **보유/현금은 거래 이벤트에서 실시간 계산 → 단순하면서 재현성 보장**

### 4.1 디렉토리 구조
```
/data
├─ symbols.json          # 종목 마스터
├─ prices_daily/         # 일별 가격 데이터
│  └─ {symbol}_{date}.json
├─ indicators_daily/     # 기술지표 데이터  
│  └─ {symbol}_{date}.json
├─ news/                # 뉴스 데이터
│  └─ {date}.json
├─ trades.json          # 거래 내역
├─ cash_events.json     # 입출금 내역
└─ report/              # 생성된 리포트
   └─ {date}_{sector}.md
```

### 4.2 JSON 스키마

**symbols.json**
```json
[
  {
    "symbol": "NVDA",
    "name": "NVIDIA Corporation", 
    "exchange": "NASDAQ",
    "sector": "ai",
    "industry": "Semiconductors",
    "active": true
  }
]
```

**prices_daily/{symbol}_{date}.json**
```json
{
  "symbol": "NVDA",
  "date": "2024-01-15",
  "open": 100.0,
  "high": 105.0,
  "low": 98.0,
  "close": 103.0,
  "volume": 50000000
}
```

**trades.json**
```json
[
  {
    "id": 1,
    "traded_at": "2024-01-15T09:30:00Z",
    "symbol": "NVDA",
    "side": "BUY",
    "qty": 10,
    "price": 100.0,
    "fee": 1.0,
    "note": "매수 주문"
  }
]
```

> 보유량/현금 잔고는 trades.json과 cash_events.json을 기반으로 실시간 계산

---

## 5. 핵심 로직

### 5.1 EMA/RSI 계산 요약

* EMA(L): `α=2/(L+1)`, `EMA_t=α*P_t+(1-α)*EMA_{t-1}`
* RSI(14): 평균상승/하락으로 RS→RSI 산출

### 5.2 점수/신호(초기안)

* 모멘텀: `ema20>ema50`=+1, 반대 -1
* RSI: `<35` 과매도(+), `>70` 과매수(−)
* 뉴스 감성: 평균 감성 `>+0.2` 호재, `<-0.2` 악재(최신 가중)
* 종합점수: `score = w1*momentum + w2*rsi_signal + w3*news`

### 5.3 주문 제안(요지)

* 보유/현금 스냅샷 후 섹터 내 후보 스코어링
* 매수: `score>=τ_buy` & `RSI<60`, 매도: `score<=τ_sell` 또는 `RSI>70`
* 비중 상한 20%, 부분매도 30% 기본, 수량은 정수화

---

## 6. API (Express)

* 인증: `x-api-key: ${API_KEY}`

```
POST /v1/trades             # 거래 입력(BUY/SELL)
POST /v1/cash               # 입출금 입력
POST /v1/ingest/prices      # 가격 수집
POST /v1/ingest/indicators  # 지표 계산
POST /v1/ingest/news        # 뉴스 수집
POST /v1/report/generate    # 리포트 생성(파일 저장 + 서버 업로드)
POST /v1/report/send        # 최신 리포트 이메일 발송
POST /v1/run/daily          # 전체 파이프라인 실행
GET  /v1/health             # 헬스체크
```

---

## 7. 크론 & 자동화

### 7.1 GitHub Actions 스케줄(KST 16:00)

* **UTC 07:00 = KST 16:00** 평일 실행 → 서버가 휴장일 판단

```yaml
name: daily-report
on:
  schedule:
    - cron: '0 7 * * 1-5'
jobs:
  run:
    runs-on: ubuntu-latest
    env:
      TZ: Asia/Seoul
      BASE_URL: ${{ secrets.BASE_URL }}
      API_KEY: ${{ secrets.API_KEY }}
    steps:
      - name: Call daily pipeline (KST 16:00)
        run: |
          curl -s -f -X POST "$BASE_URL/v1/run/daily" -H "x-api-key: $API_KEY"
```

### 7.2 서버 내부 파이프라인

0. `isNasdaqOpen(today)` 검사(주말/미국 휴일 스킵)
1. **동적 종목 스크리닝**: 섹터별 키워드 기반 종목 발견 및 분석
2. **섹터별 처리**: 발견된 종목들에 대해 가격/지표/뉴스 수집
3. **종합 분석**: 모멘텀/뉴스감성/기술적 점수 계산 및 매수/매도/보유 추천
4. **AI 보고서 생성**: `prompt.md` + OpenAI GPT‑5로 섹터별 리포트 생성
5. **파일 저장 및 발송**: `/data/report/{date}_{sector}.md` 저장 → 이메일 발송

---

## 8. 리포트 템플릿(출력 MD)

```md
# 📊 데일리 리포트 – {{DATE}} (섹터: {{SECTOR_TITLE}})

## 요약
- 포트폴리오 가치: ${{portfolio_value}}
- 현금 보유: ${{cash}}
- 보유 상위: {{top_holdings}}
- 섹터 모멘텀: {{sector_momentum}} | 뉴스 감성: {{sector_sentiment}}

## 주문 제안
{{#each suggestions}}
- **{{symbol}}**: {{action}} {{qty}}주 — _{{reason}}_
{{/each}}

## 보유 종목 상태
| 종목 | 수량 | 평단 | 현재가 | 평가손익 | RSI14 | EMA20>EMA50 |
|---|---:|---:|---:|---:|---:|:---:|
{{holdings_table}}

## 섹터 뉴스 Top N
{{#each news}}
- ({{published_at}}) **{{title}}** — {{source}} [링크]({{url}})
  - 요약: {{summary}}
  - 감성: {{sentiment}}
{{/each}}

## 메서드
- 지표: EMA(20/50), RSI(14)
- 신호 가중치: w1={{w1}}, w2={{w2}}, w3={{w3}}
- 기간: 최근 {{lookback}}일

> *본 리포트는 투자자문이 아니며, 모든 결정과 책임은 사용자에게 있습니다.*
```

---

## 9. 서버 스켈레톤

```ts
// src/server/index.ts
import express from 'express';
import { runDaily } from '../jobs/daily';
import { auth } from './middleware/auth';

const app = express();
app.use(express.json());
app.use(auth);

app.post('/v1/run/daily', async (req,res)=>{
  await runDaily();
  res.json({ok:true});
});

app.get('/v1/health', (_,res)=> res.json({ok:true}));

app.listen(process.env.PORT||8080, ()=> console.log('server ready'))
```

---

## 10. 데이터/뉴스 서비스 추상화

```ts
// src/services/market.ts
export async function fetchDailyPrices(symbols:string[]): Promise<Record<string, {date:string, close:number}[]>> { /* provider 스위치 */ }
export function computeIndicators(closes:number[]): {ema20:number, ema50:number, rsi14:number} { /* 5.1 */ }

// src/services/news.ts
export async function fetchNews(opts:{symbols:string[], sector?:string}): Promise<NewsItem[]> { /* provider 스위치 */ }
export function summarizeAndScore(text:string): {summary:string, sentiment:number} { /* 간단 요약+감성 */ }
```

---

## 11. 이메일 발송

* 발송 시각: **한국시간 16:00**, **나스닥 개장일에만**
* Resend 또는 Nodemailer(SMTP: NAVER 호환)

```ts
// src/services/mail.ts
export async function sendReportEmail({html, mdPath}:{html:string, mdPath:string}) { /* provider별 구현 */ }
```

---

## 12. 보안/운영

* API Key 헤더, HTTPS(플랫폼 기본)
* DB는 서버 측만 접근
* 뉴스/가격/이메일 호출 실패 리트라이 + 백오프
* upsert 키 고정(가격: symbol+date, 뉴스: provider+id 해시)

---

## 13. QA 체크리스트

* [ ] 가격 시계열 단조성
* [ ] EMA/RSI 샘플 스팟 검증
* [ ] 뉴스 중복·시점·출처 표기
* [ ] 보유/현금 재계산 일치
* [ ] 리포트 섹션 누락 없음
* [ ] NAVER 수신 테스트(스팸 미분류)

---

## 14. 초기 작업 순서(TODO)

* [ ] Render Free로 서버 배포 + `/v1/health` 확인
* [ ] `/data` 디렉토리 구조 생성 → JSON 파일 저장소 초기화
* [ ] `sectors.yml` 키워드 설정 (예: ai 섹터 키워드: artificial intelligence, GPU...)
* [ ] 데이터 공급자 API 키 발급/적용
* [ ] `/v1/run/daily` 수동 실행 → `/data/report` 생성 확인
* [ ] 이메일 발송 테스트
* [ ] GitHub Actions 스케줄(UTC 07:00) 활성화

---

## 15. 동적 종목 발견 시스템

### 15.1 `sectors.yml` 키워드 기반 설정

```yml
ai:
  title: "AI & Machine Learning"
  description: "인공지능, 머신러닝, 딥러닝 관련 기업"
  keywords:
    - "artificial intelligence"
    - "machine learning"
    - "AI chip"
    - "GPU"
    - "neural network"
  industries:
    - "Semiconductors"
    - "Software"
    - "Technology Hardware"
  market_cap_min: 1000000000  # 최소 시가총액
  max_symbols: 20             # 최대 종목 수

computing:
  title: "Cloud & Computing"
  description: "클라우드 컴퓨팅, 엔터프라이즈 소프트웨어"
  keywords:
    - "cloud computing"
    - "SaaS"
    - "enterprise software"
    - "cybersecurity"
  industries:
    - "Software"
    - "Technology Hardware"
  market_cap_min: 2000000000
  max_symbols: 15
```

### 15.2 동적 종목 발견 프로세스

1. **업종별 검색**: Alpha Vantage LISTING_STATUS API로 NASDAQ 전체 종목 조회
2. **키워드 매칭**: NewsAPI로 키워드 관련 뉴스에서 종목 심볼 추출
3. **관련성 점수 계산**: 종목명/설명에서 키워드 매칭도 기반 점수 산출
4. **필터링 및 저장**: 시가총액 기준 필터링 후 symbols.json에 저장
5. **스크리닝 분석**: 발견된 종목들에 대해 모멘텀/뉴스감성/기술적 분석 수행

---

## 16. `prompt.md` (시스템 프롬프트 예시 전문)

```md
# System Prompt: Stock Daily Report Generator

You are an equity strategy reporter. Produce a detailed, actionable **Korean** report for NASDAQ focus sectors.

## Inputs (JSON payload)
- lookback_days: integer (default 30)
- portfolio: { cash_usd, holdings:[{symbol, shares, avg_cost}] }
- market: { date, sector_code, sector_title }
- indicators: per-symbol { close, ema20, ema50, rsi14 }
- news: top items { published_at, source, title, url, summary, sentiment, relevance }
- scores: per-symbol composite score in [0,1]

## Output Sections (Markdown)
1. 요약: 포트폴리오 가치, 현금, 상위 보유, 섹터 모멘텀/감성
2. 주문 제안:
   - 규칙: 매도/매수/보류 별로 리스트.
   - 구체적 수량/금액 제시: 현금/가격/수수료 고려, 단일 종목 20% 상한, 부분매도 30% 기본.
   - 서술 이유: 지표(EMA 교차, RSI), 뉴스 감성, 점수 근거.
3. 보유 종목 상태 표: 수량/평단/현재가/평가손익/RSI/EMA 교차 여부
4. 섹터 뉴스 Top N: 핵심 요약과 감성
5. 방법론: 지표, 가중치, 룩백
6. 면책문구

## Style
- 간결하지만 구체적 수치 포함. 불필요한 수식어 금지.
- 표는 파이프(|) 마크다운 테이블.
- 금액/수량은 반올림 규칙 명시(수량=정수, 금액=소수 2자리).

## Constraints
- **투자자문 아님** 명시.
- 데이터 부재 시 해당 섹션 생략 대신 "데이터 부족" 표기.
```

---

## 17. OpenAI GPT‑5 호출 예시

```ts
// src/services/llm.ts
import OpenAI from 'openai';
import fs from 'node:fs/promises';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function generateReportWithOpenAI(payload:any){
  const prompt = await fs.readFile('prompt.md','utf8');
  const messages = [
    { role: 'system', content: prompt },
    { role: 'user', content: JSON.stringify(payload) }
  ];
  const res = await client.chat.completions.create({
    model: process.env.LLM_MODEL || 'gpt-5',
    messages,
    temperature: 0.2,
  });
  return res.choices[0].message?.content || '';
}
```

---

## 18. 휴장일 체크 유틸

```ts
// src/utils/marketday.ts
import { utcToZonedTime } from 'date-fns-tz';
import Holidays from 'date-holidays';

const hd = new Holidays('US');

export function isNasdaqOpen(d: Date){
  const ny = utcToZonedTime(d, 'America/New_York');
  const dow = ny.getDay();
  if (dow===0 || dow===6) return false; // Sun/Sat
  const h = hd.isHoliday(ny);
  return !h; // 필요 시 조기종료/특수 일정 확장 가능
}
```

---

## 19. 주의/한계

* 무료 API는 쿼터 제한 큼 → 캐시/집계/리트라이 필요
* 프리 호스팅은 콜드스타트 발생 가능 → 스케줄 직전 헬스콜 고려
* NAVER 수신은 도메인 인증(DKIM/SPF)하면 스팸 확률 감소
