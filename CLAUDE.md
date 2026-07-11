# CLAUDE.md

이 파일은 Claude Code (claude.ai/code)가 이 저장소의 코드로 작업할 때 지침을 제공합니다.

## 프로젝트 개요

**Nasdaq AutoTrader** — 토스증권 Open API 기반 AI 자동매매 시스템.

나스닥 개장일마다 미국 전시장(~5,800종목)을 스크리닝하고, AI 2개(Claude·GPT)가 독립 분석 리포트를 쓰면 Manager AI가 통합해 매매를 결정한다. 로컬 상시 서버가 정규장에서 결정을 집행하고, 장중에는 손절·익절 조건을 실시간 감시한다.

## 하루 사이클 (개장일마다, 스케줄러 자동)

```
정규장 40분 전 (REPORT_LEAD_MINUTES)
 ① 전시장 퍼널 스크리닝: 유니버스(주1회 캐시) → 시총·가격 필터
    → 30일 모멘텀 스캔 → 정밀분석 → 최종 추천 ~15개
 ② 에이전트 리포트: Agent_Claude + Agent_GPT 독립 분석 → 이메일
 ③ Manager 통합: 리포트 이메일 (개장 ~10분 전 도착)
    + 기계 판독용 JSON 결정 (BUY/SELL/HOLD + 손절·익절가)
 ④ 결정 집행: 정규장 개장 대기 → SELL 먼저, BUY 나중 (가드레일 통과분만)
 ⑤ 장중 감시 (매분): 손절가 도달→전량 매도 / TP1→절반 / TP2→잔량
```

## 아키텍처 원칙

1. **토스 실계좌 = 진실(source of truth)**: 현금·보유수량·평단가는 항상 토스 실시간 조회. 폴백 없음 — 조회 실패 시 낡은 값으로 진행하지 않고 명시적으로 실패한다.
2. **앱 JSON = 의도와 기록**: 토스가 모르는 것만 앱이 보관한다.
   - `positions.json` — 손절·익절가, 진입 시점, 매수 근거 (매 사이클 토스와 reconcile)
   - `decisions.json` — Manager 결정의 불변 이력
   - `trades.json` — 주문 감사 기록 (24h 매수한도 계산·진입시각 유도에 사용, dry-run은 기록 안 함)
   - `universe.json` — 토스 거래가능 미국 보통주 캐시 (주 1회 갱신)
3. **결정과 집행의 분리**: Manager는 JSON으로 의도만 선언, 집행기는 가드레일을 통과한 주문만 전송. LLM 환각은 가드레일이 막는다.
4. **정규장 전용**: 프리마켓/애프터마켓 주문 금지 — 주문 최후 관문(executeOrder)에서 강제.

## 모듈 지도

| 파일 | 역할 |
|---|---|
| `services/toss.ts` | **모든 토스 호출의 단일 관문.** 토큰 single-flight, 401/429 자가회복, 시세·캔들·환율·보유·주문·US캘린더. 문자열↔숫자 변환은 이 파일 경계에서만 |
| `services/universe.ts` | 나스닥 공식 디렉토리(무키) + 토스 `/stocks` 검증 → 유니버스 캐시 |
| `services/screening.ts` | 전시장 4단계 퍼널 + 종목 정밀분석 (`runMarketWideScreening`) |
| `services/manager.ts` | Manager 통합 리포트 생성 (실계좌 데이터 주입) |
| `services/decision.ts` | 리포트 → JSON 결정 파싱 → decisions.json |
| `services/executor.ts` | 결정 → 주문 변환, 개장 대기, SELL→BUY 순서 |
| `services/trading.ts` | **주문 최후 관문 — 가드레일 전부 여기** (정규장·한도·잔고·티커 검증, dry-run 게이트) |
| `jobs/scheduler.ts` | 매분 틱: 토스 캘린더로 개장일 판정 → 리포트 트리거 + 장중 감시 호출 |
| `jobs/watcher.ts` | 장중 SL/TP 실시간 판정·매도 (`judge`는 순수 함수 — 테스트 가능) |
| `jobs/weekly.ts` / `jobs/manager.ts` | 에이전트 리포트 / Manager 파이프라인 (스케줄러가 순차 호출) |
| `storage/positions.ts` | 포지션(보유+계획) 저장소, 토스 reconcile |
| `storage/database.ts` | JSON 파일 DB + 토스 위임 (getHoldings/getCashBalance는 토스 전용) |

## 개발 환경

### 실행 명령어
```bash
npm run build     # tsc 빌드 (필수 — 실행은 dist/ 기준)
npm start         # 상시 서버: 웹 + 스케줄러 (운영은 이거 하나)
npm run report    # 리포트 파이프라인 수동 1회 (테스트용)
npm run typecheck # 타입 체크
```

⚠️ `npm run dev`(tsx)는 node_modules가 Windows에서 설치된 상태면 macOS에서 실패한다. `npm run build` 후 dist를 실행할 것.

### 필수 환경 변수 (.env)
```env
# 토스증권 Open API (시세·계좌·주문 전부)
TOSS_API_KEY=tsck_live_...
TOSS_SECRET_KEY=tssk_live_...

# 자동매매 안전장치
TOSS_DRY_RUN=true                # false = 실주문! 사용자 명시 승인 후에만 변경
TOSS_MAX_ORDER_USD=1000          # 종목당 주문 한도
TOSS_MAX_DAILY_BUY_USD=2000      # 24시간 누적 매수 한도
TOSS_MAX_PRICE_DEVIATION_PCT=20  # LIMIT 가격 괴리 허용치

# LLM (역할별 분리)
CLAUDE_MODEL=...    # Agent_Claude 리포트용
LLM_MODEL=...       # Agent_GPT 리포트용
MANAGER_MODEL=claude-opus-4-8  # 결정권자 — 최상위 모델 유지

# 스케줄 (선택)
REPORT_LEAD_MINUTES=40   # 정규장 시작 몇 분 전 파이프라인 시작
ENABLE_SCHEDULER=true    # false면 서버만 구동
AUTO_EXECUTE_DECISION=true  # false면 결정 기록만, 집행 안 함

# 기타: OPENAI_API_KEY, CLAUDE_API_KEY, RESEND_API_KEY, MAIL_TO,
#       NEWSAPI_API_KEY, USD_KRW_RATE(환율 폴백), SCREEN_* (스크리닝 노브)
```

## 안전 수칙 (절대 준수)

1. **`TOSS_DRY_RUN=false` 전환은 사용자가 명시적으로 지시할 때만.** 어떤 리팩토링·테스트에서도 임의로 켜지 않는다.
2. **하드코딩 금지**: 수량·가격·심볼을 코드에 박지 않는다. 항상 토스 API 또는 사용자 입력에서 가져온다 (`docs/DANGER-ZONE.md`).
3. **trades.json은 감사 기록**: 직접 수정 금지, 수정이 불가피하면 백업 먼저. 잔고 계산에는 더 이상 사용되지 않는다 (잔고 = 토스 실시간).
4. **통화 구분**: 보유종목에 KRW 종목이 섞일 수 있다. `currency` 필드를 무시하고 USD로 가정하는 계산을 새로 만들지 말 것 (환율 이중적용 사고 이력 있음).
5. **가드레일 우회 금지**: 주문은 반드시 `trading.executeOrder`를 거친다. `toss.createOrder` 직접 호출 금지.
6. **LLM 검증 시 모델 임의 변경 금지**, 실사용 토큰 수는 사용자에게 보고.

## 코딩 규칙

- 모든 함수·메서드에 **한글 주석** (목적, 매개변수, 반환값)
- 토스 API의 수량/가격은 전부 **문자열** — 숫자 변환은 `toss.ts` 안에서만
- 주문·잔고 관련 신규 코드는 dry-run으로 실검증 후 반영
- 리포트 생성 실패가 이메일·집행을 막지 않도록 단계별 try/catch 격리 유지

## 문제 발생 시

- **토스 401 (invalid-token)**: 다른 프로세스가 토큰을 재발급하면 기존 토큰이 무효화됨 — `toss.ts`가 1회 자동 재발급하므로 반복되면 동시 실행 프로세스를 확인
- **429**: 지수 백오프 내장 (4회). 반복되면 스캔 동시성(`mapWithConcurrency` limit)을 낮출 것
- **결정 JSON 파싱 실패**: 리포트는 저장됨. `promptManagerSimple.md`의 "기계 판독용" 섹션과 실제 출력을 대조
- **데이터 오류**: 즉시 중단 → 백업 복원 → `docs/DANGER-ZONE.md` 참고

---

**최종 갱신**: 2026-07-11 · **버전**: 토스 자동매매 v2.0 (전시장 스크리닝 + 정규장 자동집행 + SL/TP 실시간 감시)
