당신은 숙련된 Python 아키텍트이자 금융 데이터 엔지니어입니다.
다음 조건을 만족하는 미국 나스닥 주식 자동 트레이딩 시스템 프로젝트의 **전체 스캐폴딩 코드**를 생성하세요.

[목표]
- Python 프로젝트
- 폴더 구조는 모듈별로 효율적으로 구성
- 매매 판단: OpenAI API 기반 (JSON 출력, 최신 뉴스/시세/기술지표 활용)
- 실제 매매(주문)는 아직 구현하지 않고, Kiwoom 미국주식 API용 Stub만 생성
- API 키/토큰 등 민감정보는 `.env`로 관리
- 매일 아침 LLM이 추천 주식 리포트를 PDF/Markdown으로 생성
- 거래 종목은 미국 나스닥 상장주로 제한
- AI는 데이터+창의적 시나리오를 근거로 판단
- 확장성과 테스트 가능성을 고려한 구조

[기능]
1. **데이터 수집 모듈(ingest)**
   - 나스닥 심볼 목록
   - 시세 데이터 (가격/거래량)
   - 기술 지표 계산 (RSI 등)
   - 뉴스 수집
   - 데이터 캐싱 및 표준화

2. **특징 엔지니어링(features)**
   - 기술지표 계산기
   - 뉴스 감성 요약
   - 종목 필터링

3. **AI 의사결정 모듈(llm)**
   - OpenAI API 호출 래퍼
   - 프롬프트 템플릿
   - JSON 스키마 검증기
   - 리스크 룰 적용

4. **브로커 연동 모듈(broker)**
   - BrokerAdapter 인터페이스
   - KiwoomUSStub 클래스 (주문 미실행, 로깅만)

5. **리포트(report)**
   - Markdown → PDF 변환
   - 리포트 생성기
   - 이메일/슬랙 알림 옵션

6. **스케줄러(scheduler)**
   - 크론/Task Scheduler에서 호출 가능한 스크립트
   - 장 전 리포트 생성, 장중 의사결정 루프

7. **스토리지(storage)**
   - 데이터/로그 디렉토리 구조
   - SQLite/Parquet 저장 옵션

8. **유틸리티(utils)**
   - 로깅
   - 시간대 변환(KST↔ET)
   - JSON 스키마 검증

9. **테스트(tests)**
   - 주요 모듈 단위테스트

[요구 사항]
- 폴더 구조 예:
  autotrader/
    app.py
    config.py
    ingest/
    features/
    llm/
    broker/
    report/
    scheduler/
    storage/
    utils/
    tests/
    requirements.txt
    .env.example
    README.md
- `.env.example`에는 모든 환경변수 키 목록 포함 (값은 비움)
- `requirements.txt`에 필요한 모든 라이브러리 명시
- `README.md`에 설치/실행 방법, 프로젝트 개요 포함
- 각 모듈에 간단한 docstring 작성
- 주요 함수/클래스에는 타입 힌트와 주석 포함
- 테스트 코드에서 pytest 사용
- 코드 실행 시 최소한 샘플 데이터로 리포트가 생성되도록 더미 데이터 포함

[출력 형식]
- 폴더 구조
- 각 파일의 코드 (Python, Markdown, .env.example, requirements.txt 등)
- 모든 파일은 코드 블록으로 감싸서 구분
- 각 파일 위에는 `# filename` 주석 표기

[주의]
- OpenAI API 호출부는 실제 키 없이 `.env`에서 로드하는 코드로 작성
- Kiwoom API 부분은 Stub 클래스로 로깅만 수행
- 뉴스/시세 수집부는 더미 데이터 리턴하도록 작성
- PDF 변환은 reportlab 또는 적절한 라이브러리 사용
- LLM 출력은 의사결정 JSON 스키마를 따르도록 샘플 포함
