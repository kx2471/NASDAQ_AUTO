# 이 폴더의 JSON은 읽기용 사본입니다

원본은 `data/db/autotrader.sqlite` (SQLite)입니다. 여기 있는 `trades.json`, `decisions.json`,
`positions.json`, `performance_history.json`, `llm_usage.json`, `pipeline_runs.json`,
`scheduler_state.json`, `screen_setups.json`은 서버가 10분마다(바뀐 게 있을 때) DB에서 내보냅니다.

- **여기서 고쳐도 반영되지 않습니다.** 다음 내보내기 때 덮어쓰입니다.
- 열람, git 운영 기록, `STORAGE_BACKEND=json`으로 되돌릴 때를 위한 것입니다.
- `universe.json`만 예외로 실제 캐시 파일입니다.
