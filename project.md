AutoTrader 프로젝트 가이드 (초안 v0.1)
이 문서는 더미 데이터 기반 최소 실행 버전에서 실 서비스 구조로 확장하기 위한 상세 실행 가이드입니다.
목표: 매일 아침 리포트 자동 생성, 장중 의사결정 루프(주문은 현재 Stub), 추후 실 API로 단계적 교체.

1. 요구사항
Python 3.10+

가상환경 권장 (venv or conda)

인터넷 연결(추후 실데이터/LLM 연동 시)

OS: Windows/Mac/Linux

2. 설치 & 초기 실행
bash
복사
편집
# (1) 가상환경 생성/활성화
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

# (2) 의존성 설치
pip install -r requirements.txt

# (3) 환경파일 생성
cp .env.example .env
# 필요한 값을 채우세요(처음엔 비워둬도 더미 실행 가능)

# (4) 더미 데이터로 아침 리포트 생성
python app.py
# data/reports/report_YYYYMMDD_HHMM.md/.html 생성 확인
3. 프로젝트 구조
csharp
복사
편집
autotrader/
  app.py                      # 엔트리포인트(현재 premarket_report 실행)
  config.py                   # 공통 설정/.env 로더
  requirements.txt
  .env.example
  README.md (본 문서)

  ingest/
    __init__.py
    universe.py               # 나스닥 유니버스(심볼 리스트)
    marketdata_base.py        # 시세 더미/향후 실제 어댑터 교체 지점
    news_base.py              # 뉴스 더미/향후 실제 어댑터 교체 지점

  features/
    __init__.py
    indicators.py             # RSI 등 기술지표

  llm/
    __init__.py
    openai_client.py          # LLM 호출 래퍼(현재 Stub)
    decision_engine.py        # 후보 구성/LLM 호출/결과 통합

  broker/
    __init__.py
    base.py                   # BrokerAdapter 인터페이스
    kiwoom_us_stub.py         # 키움 미국주식 Stub(로깅만)

  report/
    __init__.py
    render.py                 # Markdown/HTML 리포트 생성

  scheduler/
    __init__.py
    jobs.py (추가 예정)

  storage/
    __init__.py
    paths.py (추가 예정)
    db.py (옵션)

  utils/
    __init__.py
    timezones.py
    logging.py
    validation.py (추가 예정: JSON 스키마 검증)

  tests/
    test_indicators.py        # 예시 유닛테스트
4. 환경 변수(.env)
민감 정보는 Git에 커밋 금지! .env.example만 커밋하고 실제 .env는 로컬/서버에만 보관.

env
복사
편집
# OpenAI
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini

# Market Data / News (실연동 시 하나 이상 선택)
ALPHAVANTAGE_API_KEY=
POLYGON_API_KEY=
IEXCLOUD_API_KEY=
FINNHUB_API_KEY=

# Broker (추후 실제 연동 시)
KIWOOM_APPKEY=
KIWOOM_APPSECRET=

# Report & Paths
DATA_DIR=./data
REPORT_OUT=./data/reports
ENV=dev
5. 실행 모드
5.1 프리마켓 리포트(현재 구현)
더미 시세/뉴스 → RSI 계산 → LLM Stub 의사결정 → Markdown/HTML 리포트 저장

bash
복사
편집
python app.py
5.2 장중 루프(추가 예정)
미국장(KST 22:30~05:00, 서머타임 기준) 동안 N분 주기:

최신 가격/뉴스 갱신(경량)

LLM 의사결정 재평가

(현 단계) 주문 스텁: 로깅만

6. 모듈 상세 & 교체 지점
6.1 ingest (데이터 수집)
universe.py: 나스닥 상장 유니버스 관리(초기엔 하드코딩 → 추후 공식 리스트 동기).

marketdata_base.py:

지금: get_dummy_prices(symbol) 가짜 종가 시계열 리턴

교체: marketdata_alpha.py(Alpha Vantage), marketdata_polygon.py(Polygon) 등 구현

news_base.py:

지금: get_dummy_news(symbols) 더미 헤드라인

교체: news_finnhub.py 등 구현

교체 가이드(예):

python
복사
편집
# ingest/marketdata_alpha.py (예시 스켈레톤)
import requests, os
API_KEY = os.getenv("ALPHAVANTAGE_API_KEY")

def get_prices(symbol: str):
    # Alpha Vantage TIME_SERIES_DAILY_ADJUSTED 등 호출 후
    # closes 리스트로 변환하여 {"symbol":sym, "closes":[...]} 형태로 반환
    ...
그리고 app.py에서:

python
복사
편집
# from ingest.marketdata_alpha import get_prices as get_dummy_prices
로 import 교체.

6.2 features (지표/특징)
indicators.py: RSI 구현(간단형).

확장: SMA/EMA/ATR/볼린저밴드 추가 → featurizer.py에서 종합 스코어 산출.

6.3 llm (의사결정)
decision_engine.py:

가격/지표/뉴스 → 후보 배열(candidates) 구성

OpenAIClient.decide(payload) 호출

openai_client.py:

지금: RSI만 보고 BUY/SELL/조건 생성(Stub)

교체: 실제 OpenAI API 호출(JSON 모드) + 프롬프트 템플릿 적용

실연동 체크리스트

.env에 OPENAI_API_KEY 입력

openai 라이브러리 추가 → requirements.txt 갱신

프롬프트(의사결정 JSON 스키마) 적용

실패 시 재시도/스키마 재교정 로직(utils/validation.py) 추가

실연동 예(개략)

python
복사
편집
# llm/openai_client.py
from openai import OpenAI
import os, json

class OpenAIClient:
    def __init__(self):
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.model = os.getenv("OPENAI_MODEL","gpt-4.1-mini")

    def decide(self, payload: dict) -> dict:
        prompt = build_prompt(payload)  # 프롬프트 템플릿 적용 함수(별도 구현)
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role":"system","content":SYSTEM_PROMPT},
                      {"role":"user","content":prompt}],
            response_format={ "type": "json_object" }
        )
        data = json.loads(resp.choices[0].message.content)
        validate_schema(data)          # 실패 시 예외 → 재시도 프롬프트 사용
        return data
6.4 broker (주문)
base.py: 인터페이스 정의(buy/sell)

kiwoom_us_stub.py: 로깅만 수행(실주문 없음)

실연동 시:

kiwoom_us.py 구현(로그인/토큰/주문/조회),

app.py 혹은 루프 내에서 KiwoomUS 인스턴스 사용

보안: KIWOOM 키/시크릿은 반드시 .env에서 로딩, 로그에 민감 정보 출력 금지.

6.5 report (리포트)
render.py: 의사결정 JSON → Markdown/HTML 변환

확장:

표/섹션 추가(Top Picks, 포지션 점검, 이벤트 캘린더)

PDF 변환(예: weasyprint, reportlab) 추가

Slack/Webhook/Email 발송(publisher.py) 추가

7. 스케줄링
7.1 KST 기준 추천 스케줄
아침 리포트: 매일 07:30 KST

장중 루프: 22:3005:00 KST(서머타임 기준) 동안 1015분 간격

7.2 Linux/macOS (cron)
bash
복사
편집
crontab -e
# 매일 07:30 리포트
30 7 * * * /path/to/venv/bin/python /path/to/autotrader/app.py >> /path/to/logs/report.log 2>&1
7.3 Windows (작업 스케줄러)
작업 만들기 → 트리거(매일 07:30) → 동작:
Program/script: C:\Path\to\python.exe
Arguments: C:\Path\to\autotrader\app.py
Start in: C:\Path\to\autotrader

8. 로깅 & 감사 추적
utils/logging.py의 포맷으로 콘솔 출력

권장: logs/ 폴더 생성 후 파일 핸들러 추가

향후:

LLM 요청/응답 저장(요약/해시 포함)

데이터 타임스탬프/공급자/버전 기록 → 재현성 확보

9. 테스트
bash
복사
편집
pip install pytest
pytest -q
tests/test_indicators.py 예시 제공

추가 권장 테스트

LLM JSON 스키마 검증 (utils/validation.py 도입 후)

인제스트 어댑터(실데이터 모킹)

리스크 룰(엣지 케이스)

10. 보안 수칙
.env는 절대 커밋 금지

키/토큰은 환경변수 로딩 단일 경로(config.py)로만 접근

로그에 민감 정보 출력 금지

퍼블릭 저장소 공개 시 .gitignore 재확인

11. 단계별 마이그레이션 체크리스트
 데이터 공급자 교체: ingest/marketdata_*.py, news_*.py 구현 → app.py import 교체

 지표 확장: SMA/EMA/ATR/변동성 스코어 → features/featurizer.py

 LLM 실연동: openai_client.py 실제 호출 + 프롬프트/JSON 모드 + 스키마 검증

 리스크 룰: risk/ 모듈 신설(포지션 한도, 섹터 집중, 손절/익절 레일)

 리포트 강화: Top Picks/포지션/워치리스트/이벤트/출처 표기

 스케줄러: scheduler/jobs.py + cron/작업스케줄러 등록

 주문 연동(선택): broker/kiwoom_us.py 구현 → 페이퍼→제한적 실거래

 로깅/감사: LLM 요청/응답/결과/데이터 버전 로깅

 대시보드(후순위): Streamlit/Gradio로 P/L·리스크 실시간 뷰

12. 자주 묻는 질문(FAQ)
Q1. 지금은 왜 리포트만?
A. 안전을 위해 의사결정/보고부터 고도화 → 주문은 충분한 검증 후 붙입니다.

Q2. 나스닥 필터는 어디서?
A. 초기엔 하드코딩 리스트(universe.py). 이후 공식 심볼 소스 동기 모듈 추가 권장.

Q3. LLM이 JSON을 깨뜨릴 때는?
A. utils/validation.py의 스키마 검증 + 재시도 프롬프트(스키마/오류/원본 전달)로 교정하세요.

13. 다음 작업 제안(우선순위)
llm/openai_client.py → 실제 OpenAI 연동(JSON 모드 + 재시도)

ingest → 실데이터 어댑터 1종 추가(EOD 기준 먼저)

report → Top Picks/포지션/워치리스트 섹션 강화

risk → 기본 룰(종목 10%, 섹터 25%, 총 60~90%) 적용 및 검증

scheduler → 07:30 리포트 자동화

부록 A. OpenAI 의사결정 프롬프트(요지)
text
복사
편집
[system] 당신은 나스닥 하이브리드 트레이딩 전략가입니다. 데이터+뉴스 근거, JSON 스키마 준수, 나스닥 외 배제...
[user] market_overview, positions, candidates(가격/RSI/뉴스 핵심) 를 바탕으로 아래 스키마로만 JSON 출력...
부록 B. 의사결정 JSON 스키마(요지)
json
복사
편집
{
  "as_of":"ISO-8601 KST",
  "market_view":"string",
  "actions":[
    {
      "symbol":"string","decision":"BUY|SELL|HOLD|SKIP","target_shares":0,
      "entry_plan":{"buy_zone":[0,0],"max_allocation_pct":10},
      "exit_plan":{"take_profit_pct":5,"stop_loss_pct":5,"notes":"..."},
      "reasoning":["..."],"risks":["..."],"confidence":0.0
    }
  ],
  "watchlist":["SYM", "..."],
  "constraints_check":{"total_exposure_pct":0,"sector_concentration_flags":[],"violations":[]},
  "data_sources":["..."]
}
변경 이력
v0.1 (초안): 더미 데이터 기반 리포트 생성 경로 정리, 실연동 체크리스트 포함.