import './server/index';
import { startScheduler } from './jobs/scheduler';

// 로컬 상시 서버 모드: 웹 서버 + 주간 리포트 스케줄러를 함께 구동
// (GitHub Actions 크론 대체 — ENABLE_SCHEDULER=false로 스케줄러만 끌 수 있음)
if (process.env.ENABLE_SCHEDULER !== 'false') {
  startScheduler();
}
