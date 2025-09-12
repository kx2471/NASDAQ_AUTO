# 🚀 NASDAQ AUTO - 1000만원 달성 자동 거래 시스템

**1년 내 1000만원 달성**을 목표로 하는 나스닥 주식 자동 거래 시스템 - **GPT-5 기반 과감한 투자 전략** 및 실시간 리포트 생성

## 🎯 프로젝트 개요

현재 278만원 포트폴리오를 **1년 내 1000만원 (360% 성장)**으로 만들기 위한 과감한 AI 기반 자동 거래 시스템입니다.
- **월평균 30-50% 성장** 목표
- **GPT-5 & GPT-5-nano** 활용한 고성능 AI 분석
- **실시간 RSI/EMA** 기술지표 기반 매매 신호
- **환율 리스크** 고려한 원화 기준 수익 최적화
- **76개 다양한 종목** 풀에서 최적 종목 선별

## ✨ 주요 기능 (v2.0 업그레이드)

### 🤖 AI 시스템 대폭 개선
- **GPT-5 메인 엔진**: 복합적 투자 분석 및 전략 수립
- **GPT-5-nano 요약**: 빠르고 효율적인 리포트 요약
- **과감한 매매 전략**: 15-20% 수익 시 즉시 이익실현, -8% 손절 자동화

### 📊 실시간 데이터 & 분석
- **실시간 기술지표**: RSI14, EMA20, EMA50 자동 계산 및 반영
- **포트폴리오 정확도**: 보유종목 현재가 실시간 반영
- **환율 연동**: USD/KRW 환율 변동 리스크 자동 계산
- **76개 활성 종목**: A~Z 전체 알파벳 커버 (GOOGL, META, NVDA, MSFT, AMZN 등)

### 🎯 1000만원 달성 전략
- **회전 매매**: 2-3개월 주기 고수익 종목 회전
- **집중 투자**: 확신 종목 40-50% 집중 허용
- **리스크 관리**: 빠른 손절 + 분할 익절로 기회비용 최소화
- **월간/분기별 리밸런싱**: 체계적 성과 관리

## 🏗️ 시스템 아키텍처

```
├── Express API 서버 (Node.js + TypeScript)
├── JSON 파일 데이터베이스 (로컬 저장소)
├── GitHub Actions 스케줄러 (KST 16:00 실행)
├── OpenAI GPT-5 (리포트 생성)
├── 이메일 발송 (Resend/SMTP)
└── 데이터 공급자 (Alpha Vantage, NewsAPI)
```

## 📁 프로젝트 구조

```
stock-report/
├── src/
│   ├── server/           # Express 서버 및 API
│   ├── services/         # 외부 서비스 연동 (시장데이터, 뉴스, LLM, 메일)
│   ├── jobs/             # 스케줄 작업 (데일리 파이프라인)
│   ├── storage/          # JSON 파일 데이터베이스 관리
│   ├── logic/            # 비즈니스 로직 (점수 계산, 신호 생성)
│   └── utils/            # 유틸리티 (시장 개장일, 설정 관리)
├── config/               # 설정 파일 (섹터, 공급자)
├── data/
│   ├── json/             # JSON 데이터베이스 파일들
│   └── report/           # 생성된 리포트 파일
├── .github/workflows/    # GitHub Actions 스케줄러
└── scripts/              # 유틸리티 스크립트
```

## 🚀 빠른 시작 가이드

### 1. 프로젝트 복제 및 설치

```bash
# 프로젝트 클론
git clone https://github.com/kx2471/NASDAQ_AUTO.git
cd NASDAQ_AUTO

# 의존성 설치
npm install

# 환경 변수 설정
cp .env.example .env
# .env 파일 편집 (아래 필수 API 키 입력)
```

### 2. 필수 환경 변수 설정

```bash
# OpenAI (필수 - GPT-5 사용)
OPENAI_API_KEY=your-openai-api-key

# 이메일 발송 (필수)
MAIL_TO=your-email@example.com
RESEND_API_KEY=your-resend-key  # 또는 SMTP 설정

# 데이터 공급자
ALPHAVANTAGE_API_KEY=your-alphavantage-key
NEWSAPI_API_KEY=your-newsapi-key
```

### 3. 시스템 빌드 및 실행

```bash
# TypeScript 빌드
npm run build

# 개발 모드 실행
npm run dev

# 프로덕션 실행
npm start
```

### 4. 핵심 기능 테스트

```bash
# 1. 서버 상태 확인
curl http://localhost:8080/v1/health

# 2. 통합 리포트 생성 및 메일 발송 테스트
node send-unified-report.js

# 3. 보유종목 기술지표 확인
node get-holding-indicators.js

# 4. 다양한 종목 추가 (처음 실행 시)
node add-diverse-stocks.js
```

## 🔧 환경 변수 설정

주요 환경 변수들:

```bash
# 서버 설정
PORT=8080
API_KEY=your-secure-api-key

# 데이터 공급자
ALPHAVANTAGE_API_KEY=your-alphavantage-key
NEWSAPI_API_KEY=your-newsapi-key

# OpenAI GPT
OPENAI_API_KEY=your-openai-api-key
LLM_MODEL=gpt-5

# 이메일 발송
MAIL_PROVIDER=RESEND  # or SMTP
RESEND_API_KEY=your-resend-key
MAIL_TO=your-email@example.com
```

## 📊 API 엔드포인트

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /v1/health | 서버 상태 확인 |
| POST | /v1/run/daily | 전체 데일리 파이프라인 실행 |
| POST | /v1/trades | 거래 기록 추가 |
| GET | /v1/trades | 거래 기록 조회 |
| POST | /v1/cash | 현금 입출금 기록 |
| GET | /v1/cash/balance | 현금 잔액 조회 |

## 🤖 자동화 스케줄

- **GitHub Actions**: 평일 한국시간 16시 (UTC 07시) 자동 실행
- **휴장일 체크**: 미국 시장 휴장일은 자동으로 스킵
- **에러 처리**: 실패 시 로그 기록 및 알림

## 📈 생성되는 리포트 내용 (v2.0)

### 🎯 1000만원 달성 맞춤 리포트
1. **성과 추적**: 목표 달성률 진행 상황 (현재 27.77%)
2. **포트폴리오 현황**: 실시간 현재가 반영된 정확한 수익률
3. **과감한 매매 의견**: 15-20% 수익 시 즉시 매도 권장
4. **회전 전략**: 구체적 매도/매수 계획 (주수, 금액 명시)
5. **환율 리스크**: USD/KRW 변동 시 원화 손익 변화
6. **후속 트래킹**: 주간/월간/분기별 리뷰 계획

### 📊 기술적 분석 강화
- **RSI14/EMA20/EMA50**: 모든 종목 수치 명시
- **모멘텀 지표**: RSI>70 강한 상승 종목 우선 선별
- **손익 기준**: +15~20% 익절, -8% 손절 자동화
- **목표가 설정**: 3개월 내 30-100% 수익 목표

## 🛠️ 주요 스크립트 사용 가이드

### 통합 리포트 생성 및 발송
```bash
# 완전한 통합 리포트 생성 및 이메일 발송
node send-unified-report.js

# 테스트용 통합 리포트 (파일만 생성)
node test-unified-report.js
```

### 포트폴리오 관리
```bash
# 보유종목 기술지표 조회
node get-holding-indicators.js

# 다양한 종목 추가 (76개로 확장)
node add-diverse-stocks.js

# 비활성 종목 정리
node cleanup-inactive-stocks.js
```

### 데이터 테스트
```bash
# Alpha Vantage API 테스트
node test-alphavantage.js

# 종목 스크리닝 테스트
node test-screening.js

# 심볼 데이터 확인
node test-symbols.js
```

### 리포트 발송
```bash
# 수정된 리포트 즉시 발송
node send-fixed-report.js

# 간단한 시스템 상태 리포트 발송
node send-simple-report.js
```

## 🔒 보안 및 운영

- API 키 기반 인증
- HTTPS 통신 (배포시)
- 환경변수를 통한 민감정보 관리
- Rate limiting 및 에러 핸들링

## 📝 주요 변경점 (v2.0 업데이트)

### 🚀 시스템 성능 대폭 개선
1. **GPT-5 업그레이드**: 기존 GPT-4에서 GPT-5로 업그레이드
   - 더 정확한 투자 분석 및 전략 수립
   - GPT-5-nano를 활용한 빠른 요약 시스템
   
2. **기술지표 정확도 향상**: RSI/EMA 데이터 수집 오류 해결
   - TSLA: RSI 67.17, EMA20 $341.53, EMA50 $331.33
   - PL: RSI 73.40, EMA20 $7.55, EMA50 $6.73
   
3. **종목 다양성 확대**: 14개 → 76개 활성 종목
   - A~Z 전체 알파벳 커버
   - GOOGL, META, NVDA, MSFT, AMZN 등 주요 종목 추가

### 🎯 1000만원 달성 전략 수립
- **현재 상황**: ₩2,780,874 (목표 달성률 27.77%)
- **필요 성장률**: 연간 360% (월평균 30-50%)
- **과감한 전략**: 보수적 운용 대신 고위험-고수익 추구
- **환율 리스크**: USD/KRW 1,390.15 기준 변동성 고려

### 🔄 체계적 관리 시스템
- **주간 체크포인트**: 매주 목요일 성과 리뷰
- **월간 리밸런싱**: 포트폴리오 전면 점검
- **분기별 전략 수정**: 시장 환경 변화 대응
- **긴급 대응 매뉴얼**: ±15% 급변동 시 즉시 재분석

## 🛠️ 개발 및 기여

### NPM 스크립트 명령어
```bash
npm run dev        # 개발 서버 실행
npm run build      # TypeScript 빌드
npm run start      # 프로덕션 실행
npm run lint       # 코드 린팅 (없음)
npm run typecheck  # 타입 체크 (없음)
npm run migrate    # 데이터베이스 마이그레이션 (없음)
```

### 새로운 스크립트 추가 시
새로운 스크립트나 모듈을 작성할 때 지켜야 할 규칙:
- **한글 주석**: 모든 함수에 한글로 목적과 매개변수 설명
- **README 업데이트**: 새 스크립트의 기능과 사용법 문서화  
- **오류 처리**: try-catch 및 명확한 오류 메시지
- **환경변수**: 필요한 API 키와 설정값 명시

### 코딩 규칙 준수
- 함수명은 영어, 주석은 한글
- 모든 console.log는 이모지와 함께 명확한 상태 표시
- 환경변수는 .env 파일을 통해 관리
- 비동기 처리 시 반드시 try-catch 사용

## 🚨 면책사항

본 시스템은 투자 참고용으로만 제작되었으며, 투자자문이 아닙니다. 모든 투자 결정과 그에 따른 손익에 대한 책임은 사용자에게 있습니다.

## 📞 문의 및 지원

프로젝트 관련 문의사항이나 버그 리포트는 GitHub Issues를 통해 제출해 주세요.

---

## 📋 v2.0 설치 체크리스트

### 기본 설치
1. [ ] `git clone https://github.com/kx2471/NASDAQ_AUTO.git` 프로젝트 복제
2. [ ] `npm install` 의존성 설치
3. [ ] `.env` 파일 설정 (OpenAI API 키 필수!)
4. [ ] `npm run build` TypeScript 빌드
5. [ ] `curl http://localhost:8080/v1/health` 서버 테스트

### 핵심 기능 테스트
6. [ ] `node get-holding-indicators.js` 보유종목 기술지표 확인
7. [ ] `node add-diverse-stocks.js` 76개 종목으로 확장
8. [ ] `node send-unified-report.js` 통합 리포트 생성 및 메일 발송

### 1000만원 전략 시스템 확인
9. [ ] 메일에서 **과감한 매매 전략** 확인
10. [ ] **환율 리스크** 계산 정확성 확인
11. [ ] **RSI/EMA 데이터** 정상 표시 확인
12. [ ] **구체적 매수/매도 계획** (주수, 금액) 확인

---

## 🎯 **v2.0 업그레이드 완료!**

### ✅ 주요 달성 사항:
- **GPT-5 시스템**: 고성능 AI 분석 엔진 구축
- **1000만원 전략**: 과감한 투자 전략 및 체계적 관리 시스템
- **76개 종목**: 다양한 투자 기회 확보
- **실시간 분석**: RSI/EMA 정확도 및 환율 연동
- **완전 자동화**: 리포트 생성부터 메일 발송까지

**현재 진행률**: 27.77% (₩2,780,874/₩10,000,000)  
**다음 목표**: 월말까지 35% 달성! 🚀