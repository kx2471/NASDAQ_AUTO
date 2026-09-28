# 📈 Nasdaq AutoTrader

**토스증권 Open API 기반 AI 자동매매 시스템** — 나스닥 개장일마다 미국 전 종목을 스크리닝하고, AI 에이전트 2명의 독립 분석을 Manager AI가 통합해 매매를 결정합니다. 로컬 상시 서버가 정규장에서 결정을 집행하고, 장중에는 손절·익절 조건을 매분 감시합니다.

> ⚠️ **실계좌 운용 중입니다** (`TOSS_DRY_RUN=false`). 모든 주문은 가드레일(`services/trading.ts`)을 통과해야 전송됩니다. 투자 자문이 아니며, 손실 책임은 사용자에게 있습니다.

---

## 하루 사이클

개장일마다 스케줄러가 자동으로 돌립니다. 시각은 한국시간(KST) 기준이고, 미국 서머타임 중 정규장은 22:30~05:00입니다.

```
21:50  (개장 40분 전)
  ① Manager 모델 사전 점검 ── 호출 불가(크레딧 소진 등)면 여기서 중단 → 앞 단계 비용 낭비 방지
  ② 전시장 스크리닝     유니버스 ~5,100종목 → 시총·가격 필터 → 모멘텀 스캔 → 정밀 분석 40개
                        → 진입 셋업 3종(CONTINUATION·PULLBACK·STEADY)에서 5개씩 균등 선발
  ③ 에이전트 분석       Agent_Claude + Agent_GPT가 독립적으로 추천 (셋업별로 따로 검토)
  ④ Manager 통합        두 의견 + 규칙서 + 실현 원장 + 성과(환율 분리) → 결정 JSON
  ⑤ 사후 검증           결정이 실제로 남았는지 확인 — 없으면 실패로 보고 재시도 (최대 2회)
22:30  (개장)
  ⑥ 결정 집행           SELL 먼저, BUY 나중. 가드레일 통과분만 → 60초 뒤 체결 재확인
장중 (매분)
  ⑦ 손절·익절 감시      손절 → 전량 / 1차 익절 → 절반 / 2차 익절 → 잔량
                        1차 익절 이후엔 트레일링 보호선 (아래 참조)
  ⑧ 장중 재배치         현금 30%↑ + 보유 3종 미만 + 2시간 쿨다운 → 파이프라인 재실행
                        (매수 0건이 2회 나오면 그날 중단)
일요일 10:00
  ⑨ 주간 회고           실현 결과로 매매 규칙서를 통째로 다시 쓴다 (규칙 준수 감사 포함)
```

## 모델 구성

| 역할 | 모델 | 이유 |
|---|---|---|
| **Manager** (결정권자) | `claude-opus-5-5` · effort `xhigh` | 판단 품질이 병목인 자리. 에이전트 실수는 규칙이 걸러내지만, Manager 실수는 곧 주문이 된다 |
| Agent_Claude | `claude-sonnet-5` | 중간급 분석가, Claude 계열 관점 |
| Agent_GPT | `gpt-6-sol` | 중간급 분석가, GPT 계열 관점 |
| 주간 회고 | Manager와 동일 | 규칙서 재작성 |

에이전트 두 명은 **서로 다른 회사 모델**이어야 합니다. 같은 모델이면 관점이 겹쳐서 "독립 분석가 2명 + 중재자" 구조가 무너집니다.

## 매매 규칙 (코드로 집행)

규칙서(`data/report/manager_playbook.md`)는 Manager가 따르는 조언 계층이고 매주 다시 쓰입니다. 아래 규칙은 **LLM이 멈춰도 동작하도록** 감시기가 코드로 직접 집행합니다.

| 규칙 | 값 | 위치 |
|---|---|---|
| 최초 손절 | 평단 −8% | Manager 결정 → `positions.json` |
| 1차 익절 | 평단 +8%, 절반 매도 | 〃 |
| 2차 익절 | 평단 **+15% 상한** (Manager가 더 낮게 주면 그 값) | `watcher.effectiveTakeProfit2` |
| 트레일링 (1차 익절 이후) | `max(고점 −5%, 평단 +2%)` — 올라가기만 하고 내려가지 않음 | `watcher.effectiveStopLoss` |
| 소수점 마감 대응 | 마감 1시간 전 5분 동안 손절선 +2% 이내 포지션 선제 청산 | `watcher.judgePreCutoffExit` |

**2차 익절과 트레일링 값의 근거** (2026-09-29 조정): 1차 익절 7건을 추적해 보니 이후 최고치의 중간값은 +10.8%였고, +19%에 닿은 건 1건뿐이었습니다. 고점에서 −7%인 추적선으로는 잔량이 대부분 +2% 바닥선까지 미끄러져 팔렸습니다. 표본이 작으니 결과를 보고 다시 조정하세요. 값은 `.env`에서 바꿀 수 있습니다.

## 아키텍처 원칙

1. **토스 실계좌가 진실이다** — 현금·수량·평단은 항상 토스에서 실시간으로 조회합니다. 조회에 실패하면 낡은 값으로 진행하지 않습니다(예외: 하루 단위로만 바뀌는 캘린더는 6시간 이내 캐시로 버팀).
2. **앱 JSON은 의도와 기록이다** — 토스가 모르는 것(손절·익절 계획, 결정 이력, 감사 기록)만 보관합니다.
3. **결정과 집행을 분리한다** — Manager는 JSON으로 의도만 선언하고, 가드레일을 통과한 주문만 나갑니다.
4. **정규장 전용** — 프리마켓·애프터마켓 주문은 최후 관문에서 차단합니다.
5. **계산은 한 곳에서** — 같은 질문에 답하는 코드가 둘이면 언젠가 서로 다른 답을 냅니다. 화면·Manager·원장은 같은 함수를 씁니다(`computeFxSplit`, `computeRealizedBySellId`, `effectiveStopLoss` 등).

## 대시보드

`http://localhost:8080/dashboard` — 모바일과 데스크톱을 모두 지원합니다.

- **시스템 상태**: Manager 모델 가용성(3시간마다 점검), 최근 파이프라인 성공·실패 사유, 감시기 하트비트, 재배치 안전핀. 정상이면 조용하고, 이상이 생기면 빨갛게 표시됩니다.
- **수익률**: 원화 손익을 **매매 / 환율**로 분해하고 달러 기준 수익률을 함께 보여줍니다.
- **보유 포지션**: 실제 집행 기준의 손절가·2차 익절가, 손절→익절 구간에서 현재가 위치, `트레일링` 표시
- **자산 추이**: 자산 모드(입금 표시·매매 마커) / 수익률 vs 나스닥 모드(달러 기준, 입출금 제외)
- **성과 분석**: 청산 사유별(AI 재량 매도 vs 손절 vs 익절), 진입 셋업별 실현 손익
- **LLM 사용량**: 역할별·일별 토큰과 비용 (`LLM_PRICE_*` 설정 시)
- 거래 내역(매도 실현 손익), Manager 결정·근거, 규칙서, 의사결정 저널, 리포트

## 실행

```bash
npm install
npm run build        # tsc 빌드 — 실행은 dist/ 기준
npm start            # 상시 서버: 웹 + 스케줄러 (운영은 이거 하나)
npm run report       # 리포트 파이프라인 수동 1회
npm run typecheck
```

운영은 macOS launchd로 합니다(`~/Library/LaunchAgents/com.nasdaq.autotrader.plist`).

```bash
launchctl kickstart -k gui/$(id -u)/com.nasdaq.autotrader   # 재시작 (배포)
tail -f ~/Library/Logs/nasdaq-autotrader.log                 # console.log
tail -f ~/Library/Logs/nasdaq-autotrader.error.log           # console.warn / error — 실패 원인은 여기
```

> ⚠️ **배포 금지 구간**: 결정이 파싱된 뒤 집행이 끝나기 전(대략 21:50~22:31 KST)에는 재시작하지 마세요. 집행기가 메모리에서 개장을 기다리고 있습니다.
>
> ⚠️ `node_modules/.bin/tsc`가 권한 오류를 내면 `node node_modules/typescript/bin/tsc`로 빌드하세요.

## 환경 변수 (.env)

| 구분 | 변수 | 설명 |
|---|---|---|
| 토스 | `TOSS_API_KEY`, `TOSS_SECRET_KEY` | Open API 자격증명. 허용 IP 등록 필요(유동 IP면 바뀔 때마다 재등록) |
| 안전장치 | `TOSS_DRY_RUN` | `false` = 실주문. **사용자 명시 승인 없이 바꾸지 않는다** |
| | `TOSS_MAX_ORDER_USD`, `TOSS_MAX_DAILY_BUY_USD` | 종목당 / 24시간 누적 매수 한도 |
| | `TOSS_MAX_PRICE_DEVIATION_PCT` | LIMIT 가격 괴리 허용치 |
| LLM | `MANAGER_MODEL`, `CLAUDE_MODEL`, `LLM_MODEL` | Manager / Agent_Claude / Agent_GPT |
| | `CLAUDE_API_KEY`, `OPENAI_API_KEY` | |
| | `LLM_PRICE_<모델>` | 100만 토큰당 USD `입력,출력` (예: `LLM_PRICE_CLAUDE_OPUS_5_5=4,20`). 비용 표시용 |
| 스케줄 | `REPORT_LEAD_MINUTES` (40) | 개장 몇 분 전에 파이프라인 시작 |
| | `ENABLE_SCHEDULER`, `AUTO_EXECUTE_DECISION` | 스케줄러 / 자동 집행 스위치 |
| 재배치 | `REDEPLOY_CASH_RATIO` (0.3) | 이 현금 비중 이상이면 장중 재배치 검토 |
| | `REDEPLOY_MAX_NO_ACTION` (2), `REDEPLOY_MAX_POSITIONS` (3) | 무행동 상한 / 동시보유 상한 |
| 청산 | `TP2_MAX_GAIN_PCT` (15), `TRAIL_PEAK_DROP_PCT` (5), `TRAIL_FLOOR_GAIN_PCT` (2) | 2차 익절 상한 / 트레일링 폭 / 바닥선 |
| | `TRAIL_AFTER_TP1` | `false`면 트레일링 끄기 |
| | `FRACTIONAL_EXIT_BUFFER_PCT` (2) | 소수점 마감 전 선제 청산 거리 |
| 성과 | `INITIAL_CAPITAL_KRW`, `INVEST_START_DATE`, `TARGET_AMOUNT_KRW` | 수익률·목표 페이스 기준 |
| 기타 | `NEWSAPI_API_KEY`, `USD_KRW_RATE`(환율 폴백) | |

## 모듈 지도

| 파일 | 역할 |
|---|---|
| `services/toss.ts` | **모든 토스 호출의 단일 관문.** 토큰·캘린더 single-flight, 401/429 자가회복, 실패 시 백오프 |
| `services/trading.ts` | **주문 최후 관문** — 정규장·한도·잔고·티커 검증, dry-run 게이트 |
| `services/screening.ts` | 전시장 퍼널 + 셋업 3종 풀 + 셋업 태그 저장 |
| `services/manager.ts` | Manager 리포트 생성 + 모델 사전 점검 |
| `services/managerRecords.ts` | Manager 입력: 실현 원장(FIFO), 성과 궤적(환율 분리·나스닥 대비), 결정→결과, 저널, 규칙서 |
| `services/decision.ts` / `executor.ts` | 결정 JSON 파싱 / 주문 변환·개장 대기 |
| `services/weeklyReview.ts` | 주간 회고 → 규칙서 재작성 (규칙 완화 금지 조항 포함) |
| `services/llmUsage.ts` | LLM 호출별 토큰 기록 |
| `jobs/scheduler.ts` | 매분 틱: 파이프라인 트리거·재시도·사후 검증, 감시, 재배치, 상태 스냅샷 |
| `jobs/watcher.ts` | 손절·익절·트레일링 판정(순수 함수) 및 매도 |
| `storage/positions.ts` | 포지션(보유 + 계획), 토스 동기화 |
| `server/routes/dashboard.ts` | 대시보드 API |

## 데이터 파일 (`data/json/`)

| 파일 | 내용 |
|---|---|
| `trades.json` | 주문 **감사 기록** — 직접 수정 금지 (불가피하면 백업 먼저) |
| `decisions.json` | Manager 결정 이력 + 집행 결과 |
| `positions.json` | 손절·익절 계획, 진입 시각, 고점 |
| `performance_history.json` | 일별 자산·원금·환율 |
| `pipeline_runs.json` | 파이프라인 실행 결과 (최근 50건) |
| `llm_usage.json` | LLM 호출별 토큰 |
| `screen_setups.json` | 이번 사이클 후보의 진입 셋업 태그 |
| `scheduler_state.json` | 중복 실행 방지·재배치 카운터 (재시작해도 유지) |

## 운영하며 배운 것

이 시스템에서 반복된 결함은 대부분 **"평소엔 맞다가 특정 조건에서 조용히 뒤집히는 판정"** 이었습니다. 에러 없이 성공한 것처럼 끝났습니다.

- 미국 정규장은 한국 자정을 넘깁니다 → 자정 이후 감시기가 세션의 77% 동안 멈춰 있었습니다
- `utcToZonedTime().toISOString()`이 날짜를 하루 밀어 개장일을 휴장일로 판정했습니다 → 로그는 `🎉 완료 (0초 소요)`였습니다
- 캐시를 "성공했을 때만" 채우자 실패 한 번이 429 폭주로 번졌습니다
- `startsWith('gpt-5')` 판정이 `gpt-6`에서 뒤집혀 구형 파라미터를 보낼 뻔했습니다
- 셋업 태그가 Manager에는 전달됐지만 그 앞 단계인 에이전트에는 전달되지 않았습니다

그래서 새 자동화를 만들 때는 **실패 경로와 경계 조건을 먼저 의심하고, 결과를 사후에 검증**합니다.

성과 측면에서 데이터가 가리킨 결론은 이렇습니다. **규칙(손절·익절)은 돈을 벌었고, AI의 규칙 밖 재량 매도가 손실 대부분을 만들었습니다.** 그래서 개선은 모델 교체보다 재량을 줄이고 규칙을 코드로 집행하는 방향으로 해 왔습니다.

## 레거시 (사용 금지)

- `tools/add-trade.js`, `interactive-trade.js` 등 — 토스 연동 이전의 수동 매매 입력 도구입니다. 지금은 토스 실계좌가 진실이고 `trades.json`은 감사 기록이라, 이 도구로 기록을 쓰면 원장이 오염됩니다.
- `docs/GITHUB-SECRETS-SETUP.md`, Supabase·Alpaca·SMTP 관련 설정 — 구 시스템(GitHub Actions + 주간 이메일) 시절의 것입니다.

## 문서

- [CLAUDE.md](./CLAUDE.md) — 개발 지침과 안전 수칙
- [docs/DANGER-ZONE.md](./docs/DANGER-ZONE.md) — 데이터 무결성 지침

---

**최종 업데이트**: 2026-09-29 · 토스 자동매매 v2.x (전시장 스크리닝 · 셋업 3종 · 정규장 자동집행 · 트레일링 · 상태 패널)
