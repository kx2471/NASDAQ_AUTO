import fs from 'fs/promises';
import path from 'path';
import { runWeekly } from './weekly';
import { runManager } from './manager';
import { checkPositionsOnce, syncPendingFills } from './watcher';
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
let lastReportDate = '';      // 리포트를 이미 실행한 미국 영업일 (메모리 캐시)
let lastWeeklyReviewDate = ''; // 주간 회고를 실행한 KST 일요일 (메모리 캐시)
let pipelineRunning = false;  // 리포트 파이프라인 동시 실행 방지
let watcherRunning = false;   // 감시 틱 겹침 방지

// 마지막 실행일을 디스크에 보존 — 서버가 리포트 후 재시작돼도 같은 날 중복 실행
// (LLM 비용 2배 + 결정 이중 집행 위험)을 막는다
const STATE_FILE = path.join(process.cwd(), 'data', 'json', 'scheduler_state.json');

/** 스케줄러 영속 상태 */
interface SchedulerState {
  lastReportDate?: string;        // 개장 전 리포트를 실행한 미국 영업일
  lastWeeklyReviewDate?: string;  // 주간 전략 회고를 실행한 KST 일요일 날짜
}

/**
 * 디스크에 저장된 스케줄러 상태 로드
 * @returns 상태 객체 (없으면 빈 객체)
 */
async function loadState(): Promise<SchedulerState> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf-8'));
  } catch {
    return {}; // 파일 없음 = 첫 실행
  }
}

/**
 * 스케줄러 상태 부분 갱신 저장 (재시작 대비)
 * @param patch 갱신할 필드
 */
async function saveState(patch: SchedulerState): Promise<void> {
  try {
    const cur = await loadState();
    await fs.writeFile(STATE_FILE, JSON.stringify({ ...cur, ...patch }, null, 2), 'utf-8');
  } catch (error) {
    console.warn('⚠️ 스케줄러 상태 저장 실패 (재시작 시 중복 실행 위험):', error);
  }
}

/**
 * 장중 현금 재배치 트리거 판정 (순수 함수 — 테스트 가능)
 *
 * 장중 손절/익절로 현금이 풀렸을 때 다음 날까지 놀리지 않도록,
 * 조건 충족 시 리포트를 추가 발행해 재투자한다.
 * 하루 횟수 제한 대신 "마지막 Manager 결정 후 2시간 쿨다운"을 사용 —
 * 매매 직후 현금이 다시 30%를 넘는 경우에도 2시간 뒤 자동으로 재시도된다.
 *
 * @param p.msToClose           장 마감까지 남은 시간(ms)
 * @param p.cashRatio           현금(미체결 주문 제외) / 총자산 비율 (0~1)
 * @param p.msSinceLastDecision 마지막 Manager 결정(decided_at) 이후 경과 시간(ms)
 * @param p.pipelineRunning     파이프라인이 이미 실행 중인지
 * @returns 재배치 리포트를 실행해야 하면 true
 */
export function shouldRedeployCash(p: {
  msToClose: number; cashRatio: number; msSinceLastDecision: number; pipelineRunning: boolean;
}): boolean {
  const threshold = parseFloat(process.env.REDEPLOY_CASH_RATIO || '') || 0.3;
  const cooldownMs = (parseFloat(process.env.REDEPLOY_COOLDOWN_HOURS || '') || 2) * 60 * 60 * 1000;
  return !p.pipelineRunning
    && p.msSinceLastDecision > cooldownMs  // 최근 결정 후 2시간 초과 (REDEPLOY_COOLDOWN_HOURS)
    && p.msToClose > 60 * 60 * 1000        // 마감까지 1시간 초과 남음
    && p.cashRatio >= threshold;           // 현금 비중 30% 이상 (REDEPLOY_CASH_RATIO)
}

/**
 * 마지막 Manager 결정 시각 조회 (decisions.json, 로컬 파일만 — API 0회)
 * - 수동 재시도(-r1) 등 모든 결정을 포함해 가장 최근 decided_at을 반환
 * @returns epoch ms (기록 없으면 0 = 쿨다운 없음)
 */
async function getLastDecisionTime(): Promise<number> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), 'data', 'json', 'decisions.json'), 'utf-8');
    const decisions = JSON.parse(raw);
    if (!Array.isArray(decisions) || decisions.length === 0) return 0;
    // decided_at 최대값 (추가 순서가 시간순이 아닐 수 있으므로 전체 스캔)
    return decisions.reduce((max: number, d: any) => {
      const t = new Date(d.decided_at).getTime();
      return isFinite(t) && t > max ? t : max;
    }, 0);
  } catch {
    return 0;
  }
}

/**
 * 현금 비중 계산 — 현금 / (현금 + 보유 평가 + 미체결 매수대금)
 * - 미체결 주문에 묶인 돈은 "노는 현금"이 아니므로 분자에서 제외, 분모에 포함
 * - KRW 종목은 환율로 USD 환산
 * @returns 0~1 비율 (총자산 0이면 0)
 */
async function getCashRatio(): Promise<number> {
  const { getBuyingPower, getHoldings, getPrices, getOpenOrders, getExchangeRate } =
    await import('../services/toss');

  const [cash, holdings, openOrders] = await Promise.all([
    getBuyingPower('USD'), getHoldings(), getOpenOrders().catch(() => [])
  ]);

  let holdingsUsd = 0;
  if (holdings.length > 0) {
    const prices = await getPrices(holdings.map(h => h.symbol));
    const needKrw = holdings.some(h => h.currency === 'KRW');
    const rate = needKrw ? await getExchangeRate('USD', 'KRW') : 1;
    for (const h of holdings) {
      const value = h.shares * (prices[h.symbol] || h.avg_cost);
      holdingsUsd += h.currency === 'KRW' ? value / rate : value;
    }
  }

  const pendingBuyUsd = openOrders
    .filter(o => o.side === 'BUY' && o.currency === 'USD')
    .reduce((s, o) => s + (o.orderAmount ?? ((o.quantity || 0) * (o.price || 0))), 0);

  const total = cash + holdingsUsd + pendingBuyUsd;
  return total > 0 ? cash / total : 0;
}

/**
 * 리포트 파이프라인 1회 실행 (에이전트 리포트 → Manager 통합 → 결정 집행)
 * - 수동 실행: npm run report
 * @param reportIdSuffix 결정 report_id 접미사 — 장중 재배치는 '-i1'로 구분해
 *                       개장 전 결정의 이중 집행 가드와 충돌하지 않게 한다
 */
export async function runReportPipeline(reportIdSuffix: string = ''): Promise<void> {
  if (pipelineRunning) {
    console.warn('⚠️ 리포트 파이프라인이 이미 실행 중입니다 — 이번 실행을 건너뜁니다.');
    return;
  }
  pipelineRunning = true;
  const startedAt = Date.now();

  try {
    console.log(`🚀 리포트 파이프라인 시작 (에이전트 리포트 → Manager → 결정 집행)${reportIdSuffix ? ` [장중 재배치${reportIdSuffix}]` : ''}`);
    await runWeekly();
    await runManager(reportIdSuffix);
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
    // 0) 주간 전략 회고: KST 일요일 10시 이후 1회 (미장 휴장일이라 매매와 완전 분리)
    //    휴장일 early-return보다 앞에 있어야 함 — 일요일엔 today.regular가 없다.
    const kstNow = new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul', weekday: 'short', hour: '2-digit', hour12: false });
    const kstDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    if (kstNow.startsWith('Sun') && parseInt(kstNow.slice(-2), 10) >= 10 && lastWeeklyReviewDate !== kstDate) {
      const persisted = (await loadState()).lastWeeklyReviewDate;
      if (persisted === kstDate) {
        lastWeeklyReviewDate = kstDate; // 재시작 전 이미 실행됨
      } else {
        lastWeeklyReviewDate = kstDate;
        await saveState({ lastWeeklyReviewDate: kstDate });
        console.log(`📆 일요일 — 주간 전략 회고 트리거 (${kstDate})`);
        const { runWeeklyReview } = await import('../services/weeklyReview');
        void runWeeklyReview();
      }
    }

    const { today } = await getUsMarketCalendar(); // 10분 캐시 — 매분 호출해도 콜 낭비 없음
    if (!today.regular) return; // 휴장일

    const now = Date.now();
    const leadMinutes = parseInt(process.env.REPORT_LEAD_MINUTES || '', 10) || 40;
    const reportAt = today.regular.start - leadMinutes * 60 * 1000;

    // 1) 개장 전 리포트 트리거 (영업일당 1회 — 디스크 상태로 재시작에도 안전)
    //    reportAt 이후~개장 전 구간이면 실행 — 서버가 늦게 켜져도 개장 전이면 따라잡는다
    if (now >= reportAt && now < today.regular.start && lastReportDate !== today.date) {
      const persisted = (await loadState()).lastReportDate;
      if (persisted === today.date) {
        lastReportDate = today.date; // 재시작 전 이미 실행됨 — 메모리 캐시만 복구
        return;
      }
      lastReportDate = today.date;
      await saveState({ lastReportDate: today.date });
      console.log(`⏰ 개장 ${Math.round((today.regular.start - now) / 60000)}분 전 — 리포트 파이프라인 트리거 (영업일 ${today.date})`);
      void runReportPipeline();
    }

    // 2) 정규장 중 매분: 체결 지연 자가 치유 → SL/TP 감시
    //    (동기화를 먼저 해야 방금 체결된 종목도 같은 틱에서 감시 대상이 됨)
    if (now >= today.regular.start && now < today.regular.end && !watcherRunning) {
      watcherRunning = true;
      try {
        await syncPendingFills();
        await checkPositionsOnce();
      } finally {
        watcherRunning = false;
      }

      // 3) 장중 현금 재배치 (10분 간격 검사)
      //    조건: 현금 ≥30% + 마감 1시간+ 전 + 마지막 Manager 결정 후 2시간 초과.
      //    매매 직후 현금이 다시 30%를 넘어도 쿨다운이 지나면 재시도된다.
      if (new Date().getMinutes() % 10 === 0) {
        try {
          const msSinceLastDecision = now - (await getLastDecisionTime());
          const cheap = shouldRedeployCash({
            msToClose: today.regular.end - now,
            cashRatio: 1, // 일단 통과값 — 비싼 API 검사는 아래에서
            msSinceLastDecision,
            pipelineRunning
          });
          if (cheap) {
            const ratio = await getCashRatio();
            if (shouldRedeployCash({
              msToClose: today.regular.end - now,
              cashRatio: ratio,
              msSinceLastDecision,
              pipelineRunning
            })) {
              const hhmm = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit', minute: '2-digit' }).replace(':', '');
              console.log(`💸 장중 현금 재배치 트리거: 현금 ${(ratio * 100).toFixed(0)}% ≥ 30%, 마지막 결정 후 ${Math.round(msSinceLastDecision / 3600000 * 10) / 10}시간, 마감까지 ${Math.round((today.regular.end - now) / 60000)}분`);
              void runReportPipeline('-i' + hhmm);
            }
          }
        } catch (error: any) {
          console.warn('⚠️ 현금 재배치 검사 실패 (10분 후 재시도):', error.message);
        }
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
