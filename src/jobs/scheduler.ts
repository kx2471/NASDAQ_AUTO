import { runWeekly } from './weekly';
import { runManager } from './manager';
import { checkPositionsOnce } from './watcher';
import { getUsMarketCalendar, isTossEnabled } from '../services/toss';

/**
 * 로컬 상시 서버용 자동매매 스케줄러 (토스 미국 장 캘린더 기반)
 *
 * 나스닥 개장일마다:
 *  1) 정규장 시작 REPORT_LEAD_MINUTES분 전 → 리포트 파이프라인 시작
 *     (에이전트 리포트 → Manager 통합/이메일 → 개장 후 결정 집행)
 *     파이프라인 자체가 20~30분 걸리므로 리드 기본 40분 → 이메일은 개장 ~10분 전 도착
 *  2) 정규장 동안 매분 → SL/TP 감시 (조건 도달 시 실시간 매도 주문)
 *
 * - 개장일/세션 판정은 토스 /market-calendar/US가 정답 (공휴일·서머타임 자동 반영, KST 기준)
 * - 프리마켓/애프터마켓에는 아무 주문도 내지 않는다 (trading.ts 세션 가드가 이중 보장)
 *
 * 환경변수:
 *  - REPORT_LEAD_MINUTES: 정규장 시작 몇 분 전에 파이프라인을 시작할지 (기본 40)
 *  - ENABLE_SCHEDULER: 'false'면 스케줄러 비활성 (서버만 구동)
 */

let timer: ReturnType<typeof setInterval> | null = null;
let lastReportDate = '';      // 리포트를 이미 실행한 미국 영업일 (중복 방지)
let pipelineRunning = false;  // 리포트 파이프라인 동시 실행 방지
let watcherRunning = false;   // 감시 틱 겹침 방지

/**
 * 리포트 파이프라인 1회 실행 (에이전트 리포트 → Manager 통합 → 결정 집행)
 * - 수동 실행: npm run report
 */
export async function runReportPipeline(): Promise<void> {
  if (pipelineRunning) {
    console.warn('⚠️ 리포트 파이프라인이 이미 실행 중입니다 — 이번 실행을 건너뜁니다.');
    return;
  }
  pipelineRunning = true;
  const startedAt = Date.now();

  try {
    console.log('🚀 리포트 파이프라인 시작 (에이전트 리포트 → Manager → 결정 집행)');
    await runWeekly();
    await runManager();
    console.log(`🎉 리포트 파이프라인 완료 (${Math.round((Date.now() - startedAt) / 1000)}초 소요)`);
  } catch (error) {
    console.error('❌ 리포트 파이프라인 실패:', error);
  } finally {
    pipelineRunning = false;
  }
}

/**
 * 매분 틱: 리포트 트리거 판정 + 장중 SL/TP 감시
 */
async function tick(): Promise<void> {
  try {
    const { today } = await getUsMarketCalendar(); // 10분 캐시 — 매분 호출해도 콜 낭비 없음
    if (!today.regular) return; // 휴장일

    const now = Date.now();
    const leadMinutes = parseInt(process.env.REPORT_LEAD_MINUTES || '', 10) || 40;
    const reportAt = today.regular.start - leadMinutes * 60 * 1000;

    // 1) 개장 전 리포트 트리거 (영업일당 1회)
    //    reportAt 이후~개장 전 구간이면 실행 — 서버가 늦게 켜져도 개장 전이면 따라잡는다
    if (now >= reportAt && now < today.regular.start && lastReportDate !== today.date) {
      lastReportDate = today.date;
      console.log(`⏰ 개장 ${Math.round((today.regular.start - now) / 60000)}분 전 — 리포트 파이프라인 트리거 (영업일 ${today.date})`);
      void runReportPipeline();
    }

    // 2) 정규장 중 SL/TP 감시 (매분)
    if (now >= today.regular.start && now < today.regular.end && !watcherRunning) {
      watcherRunning = true;
      try {
        await checkPositionsOnce();
      } finally {
        watcherRunning = false;
      }
    }
  } catch (error: any) {
    console.error('⚠️ 스케줄러 틱 오류:', error.message);
  }
}

/**
 * 스케줄러 시작 — 매분 캘린더 기준으로 리포트/감시 판정
 */
export function startScheduler(): void {
  if (timer) {
    return; // 중복 시작 방지
  }
  if (!isTossEnabled()) {
    console.warn('⚠️ 토스 API 미설정 — 스케줄러를 시작하지 않습니다 (캘린더/매매 불가).');
    return;
  }

  const leadMinutes = parseInt(process.env.REPORT_LEAD_MINUTES || '', 10) || 40;
  console.log(
    `⏰ 자동매매 스케줄러 시작: 나스닥 개장일마다 정규장 ${leadMinutes}분 전 리포트 파이프라인, ` +
    `정규장 중 매분 SL/TP 감시 (정규장 전용 거래)`
  );

  timer = setInterval(() => { void tick(); }, 60 * 1000);
  void tick(); // 기동 직후 1회 즉시 판정 (장중 재시작 시 감시 공백 최소화)
}

/**
 * 스케줄러 중지 (테스트/종료 시)
 */
export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
