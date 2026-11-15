# 🛑 프로젝트 중지 상태 & 재시작 절차

**중지일**: 2026-11-15 (일) 10:06 KST · 사용자 지시 "모든 거래 정지해줘. 이 프로젝트는 중지할래."

관련 문서: [LESSONS.md](LESSONS.md) (교훈·재설계) · [RULES_FINAL.md](RULES_FINAL.md) (중지 시점 규칙 전체)

---

## 1. 지금 어떻게 멈춰 있나 (3중 잠금)

| 계층 | 상태 | 되돌리는 법 |
|---|---|---|
| launchd 서비스 `com.nasdaq.autotrader` | `bootout` + `disable` (재부팅·로그인해도 안 켜짐) | `launchctl enable gui/$(id -u)/com.nasdaq.autotrader` 후 `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nasdaq.autotrader.plist` |
| `.env ENABLE_SCHEDULER=false` | 서버가 켜져도 파이프라인·감시기 안 돎 | 줄 삭제 또는 `true` |
| `.env AUTO_EXECUTE_DECISION=false` | 결정이 나와도 집행 안 함 | 줄 삭제 또는 `true` |
| `.env TOSS_DRY_RUN=true` | 주문이 나가도 토스로 전송 안 함 (중지 전 값: `false`) | **사용자가 명시적으로 지시할 때만** `false` |

- Claude Code 세션 예약(평일 감시·11/29 성과 점검·주간회고 점검)은 모두 삭제했다.
- 대시보드도 서버와 함께 꺼졌다 (`localhost:8080` 응답 없음).
- 토스 계좌·DB·리포트는 그대로다. 아무것도 지우지 않았다.

## 2. 중지 시점 보유 — ⚠️ 자동 보호 없음

| 종목 | 수량 | 토스 평단 | 마지막 SL / 조기경보선 | 비고 |
|---|---|---|---|---|
| CRL | 0.17576주 | $347.40 | SL $319.61 / 경보선 $330.03 | 11/13 종가 $337.97 (−2.7%), 만료 예정이었던 날 11/24 |

서버가 꺼져 있으므로 **CRL의 손절·익절은 더 이상 자동 집행되지 않는다.** 정리·유지는 사용자가 토스 앱에서 직접 한다.
DB `positions`에는 CRL이 아직 `OPEN`으로 남아 있다. 사용자가 팔면 재시작할 때 토스와 reconcile되어 `CLOSED`가 된다.
팔지 않은 채로 재시작하면 시스템이 CRL을 자기 포지션으로 다시 관리하기 시작한다. 원치 않으면 재시작 전에 `MANUAL_SYMBOLS=CRL`로 등록한다.

## 3. 재시작 체크리스트

순서를 지킬 것. 실돈은 맨 마지막이다.

1. **재설계 먼저** — [LESSONS.md §5](LESSONS.md#5-재설계-방향-제안)를 읽고 무엇을 바꿀지 정한다. 같은 설계를 그대로 다시 켜면 같은 결과(승률 31%·손익비 0.62)가 나올 가능성이 높다.
2. **환경 점검**
   - 토스 Open API 키 유효성, **IP 화이트리스트** (유동 IP, 사용자 관리 — 바뀌면 토큰 발급부터 403)
   - Claude Code 로그인(`claude -p` 동작), OpenAI 크레딧
   - 모델명 실재 여부 (`.env CLAUDE_MODEL / LLM_MODEL / MANAGER_MODEL`)
   - `npm install && node node_modules/typescript/bin/tsc` 빌드 성공
3. **규칙서 확인** — `data/report/manager_playbook.md`는 11/15 회고가 쓴 마지막 판이다. 재설계 결과에 맞게 고치기 전에 `playbook_history/`에 백업한다.
4. **유니버스 캐시** — `universe.json`은 주 1회 갱신이라 자동으로 새로 받지만, 오래 쉬었으면 첫 파이프라인이 느리다.
5. **dry-run으로 먼저 켠다** — `TOSS_DRY_RUN=true`, `ENABLE_SCHEDULER`·`AUTO_EXECUTE_DECISION` 줄 삭제 → 서비스 enable/bootstrap.
   - 최소 2주(또는 사전에 정한 표본 수) 동안 주문안 로그·결정·감시기 판정을 관찰한다.
   - dry-run은 `trades`에 기록되지 않으므로 성과는 로그·결정 이력에서 따로 집계해야 한다.
6. **실계좌 전환** — 사전에 정한 통과 기준(예: QQQ 대비·손익비)을 넘었을 때, **사용자가 직접 지시**해서만 `TOSS_DRY_RUN=false`.
7. **재시작 시각 규율** — 미국 표준시 기준 22:50~23:31 KST(서머타임 21:50~22:31)에는 서버를 재시작하지 않는다. health의 `pipelineRunning=false`를 확인한다.

## 4. 그대로 유효한 운영 수칙

- `trades`는 감사 기록 — SQL UPDATE/DELETE 금지. DB는 `sqlite3 -readonly`로만 본다.
- 주문은 `trading.executeOrder`만 거친다. 수량·가격·심볼 하드코딩 금지.
- `.env`와 그 백업은 저장소 밖에 둔다 (저장소가 PUBLIC).
- 이 폴더에서 `git stash` / `reset` / `/teleport` 금지 (2026-10-01 운영 데이터 유실 사고).
