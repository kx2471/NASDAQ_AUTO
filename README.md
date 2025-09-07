# 📈 Stock-Report System

나스닥 주식 자동 거래 시스템 - AI 기반 일일 리포트 생성 및 이메일 발송

## 🎯 프로젝트 개요

매일 최신 뉴스와 기술지표(EMA, RSI)를 수집하여 AI가 매수/매도/보류 제안이 포함된 보고서를 생성하고, 한국시간 16시에 이메일로 발송하는 자동화 시스템입니다.

## ✨ 주요 기능

- **자동 데이터 수집**: 나스닥 종목의 가격, 기술지표, 뉴스 데이터 자동 수집
- **AI 보고서 생성**: OpenAI GPT를 활용한 투자 분석 리포트 생성
- **포트폴리오 관리**: 거래 기록 및 현금 관리를 통한 포트폴리오 자동 추적
- **이메일 자동 발송**: 한국시간 16시 일일 리포트 자동 이메일 발송
- **섹터별 분석**: AI, Computing, Nuclear 등 섹터별 맞춤 분석

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

## 🚀 설치 및 실행

### 1. 환경 설정

```bash
# 의존성 설치
npm install

# 환경 변수 설정
cp .env.example .env
# .env 파일을 편집하여 필요한 API 키와 설정값 입력
```

### 2. 데이터베이스 초기화

```bash
# JSON 데이터베이스 및 초기 데이터 생성
npm run migrate
```

### 3. 개발 서버 실행

```bash
# 개발 모드 실행
npm run dev

# 프로덕션 빌드
npm run build

# 프로덕션 실행
npm start
```

### 4. API 테스트

```bash
# 헬스체크
curl http://localhost:8080/v1/health

# 데일리 파이프라인 수동 실행 (API 키 필요)
curl -X POST http://localhost:8080/v1/run/daily -H "x-api-key: your-api-key"
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

## 📈 생성되는 리포트 내용

1. **포트폴리오 요약**: 현재 가치, 현금 보유, 보유 종목 현황
2. **주문 제안**: 매수/매도/보류 추천과 구체적 수량 및 이유
3. **보유 종목 상태**: 수량, 평균단가, 현재가, 평가손익, 기술지표
4. **섹터 뉴스**: 최신 뉴스 요약 및 감성 분석
5. **분석 방법론**: 사용된 지표와 가중치 설명

## 🔒 보안 및 운영

- API 키 기반 인증
- HTTPS 통신 (배포시)
- 환경변수를 통한 민감정보 관리
- Rate limiting 및 에러 핸들링

## 📝 개발 및 기여

### 스크립트 명령어

```bash
npm run dev        # 개발 서버 실행
npm run build      # TypeScript 빌드
npm run start      # 프로덕션 실행
npm run lint       # 코드 린팅
npm run typecheck  # 타입 체크
npm run migrate    # 데이터베이스 마이그레이션
```

### 새로운 스크립트 추가 시

새로운 스크립트나 모듈을 작성할 때는 다음 사항을 포함해 주세요:
- **기능 설명**: 스크립트의 목적과 주요 기능
- **사용법**: 실행 방법과 옵션
- **의존성**: 필요한 환경변수나 설정
- **한글 주석**: 모든 함수에 한글 주석 작성

## 🚨 면책사항

본 시스템은 투자 참고용으로만 제작되었으며, 투자자문이 아닙니다. 모든 투자 결정과 그에 따른 손익에 대한 책임은 사용자에게 있습니다.

## 📞 문의 및 지원

프로젝트 관련 문의사항이나 버그 리포트는 GitHub Issues를 통해 제출해 주세요.

---

## 📋 설치 체크리스트

1. [ ] `npm install` 실행
2. [ ] `.env` 파일 설정 (API 키 입력)
3. [ ] `npm run migrate` 실행 (JSON 데이터베이스 초기화)
4. [ ] `npm run dev` 실행 (개발 서버 시작)
5. [ ] `curl http://localhost:8080/v1/health` 테스트

---

**✅ 프로젝트 완성!** project.md의 모든 요구사항이 구현되었습니다.