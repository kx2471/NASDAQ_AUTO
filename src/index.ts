import './server/index';
import { startScheduler } from './jobs/scheduler';
import { db, STORAGE_BACKEND } from './storage/database';
import { ensureMigrated } from './storage/migrate';

// 로컬 상시 서버 모드: 웹 서버 + 주간 리포트 스케줄러를 함께 구동
// (GitHub Actions 크론 대체 — ENABLE_SCHEDULER=false로 스케줄러만 끌 수 있음)
//
// 스케줄러는 저장소 이관이 끝난 뒤에 시작한다 — 이관 전에 틱이 돌면 빈 DB를 보고
// "오늘 리포트를 안 돌렸다"고 판단해 중복 실행할 수 있다.
(async () => {
  const imported = await ensureMigrated(db);
  if (imported) {
    const summary = Object.entries(imported).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ');
    console.log(`📦 JSON → SQLite 이관 완료 (검증 통과): ${summary}`);
  }
  console.log(`🗄️ 저장소 백엔드: ${STORAGE_BACKEND}`);
  if (process.env.ENABLE_SCHEDULER !== 'false') {
    startScheduler();
  }
})().catch((e) => {
  // 이관·검증 실패 상태로 매매를 시작하지 않는다
  console.error('❌ 저장소 준비 실패 — 스케줄러를 시작하지 않습니다:', e);
  process.exit(1);
});
