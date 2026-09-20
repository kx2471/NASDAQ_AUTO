import fs from 'fs/promises';
import path from 'path';
import { runWeekly } from './weekly';
import { runManager, getKoreanDateString } from './manager';
import { checkPositionsOnce, syncPendingFills } from './watcher';
import { getUsMarketCalendar, getActiveRegularSession, isTossEnabled } from '../services/toss';

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

// 장중 재배치 안전핀 — 매수 0건으로 끝난 횟수를 세션 단위로 센다.
// 상한(REDEPLOY_MAX_NO_ACTION)에 닿으면 그날 재배치를 중단한다.
let redeployNoActionCount = 0;
let redeploySession = 0;      // 카운터가 속한 세션 시작 시각 (날이 바뀌면 초기화)

// 틱 오류 로그 중복 억제 — 같은 오류가 매분 반복되면 정상 로그를 덮는다
let lastTickErrorKey = '';
let lastTickErrorAt = 0;
let tickErrorCount = 0;

// 개장 전 파이프라인 재시도 (LLM 일시 장애 대비)
// 중복 방지 플래그(lastReportDate)를 실행 "전"에 확정하므로, 파이프라인이 실패하면
// 되돌리지 않는 한 그날 매매가 통째로 사라진다.
// (2026-08-19 02:13 Anthropic 529 overloaded_error로 Manager 단계 실패. 장중 재배치는
//  10분마다 조건을 재검사해 우연히 재시도됐고 그 두 번째 시도가 WDAY $280 매수를 냈다.
//  정규 사이클엔 그 안전망이 없어 같은 529 한 번에 그날이 날아간다)
// 리드타임 40분 안에서만 재시도하며(개장 후엔 트리거 조건 자체가 거짓), 영구 실패로
// 토큰을 태우지 않도록 횟수를 제한한다.
let reportRetryCount = 0;
let reportRetryDate = '';
const MAX_REPORT_RETRIES = 2; // 최초 1회 + 재시도 2회 = 최대 3회

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
  openPositions?: number;   // 현재 보유 종목 수 (규칙서 동시보유 상한과 대조)
  noActionCount?: number;   // 이번 세션에 '매수 0건'으로 끝난 재배치 횟수
}): boolean {
  const threshold = parseFloat(process.env.REDEPLOY_CASH_RATIO || '') || 0.3;
  const cooldownMs = (parseFloat(process.env.REDEPLOY_COOLDOWN_HOURS || '') || 2) * 60 * 60 * 1000;

  // 무행동 상한 — 재배치가 연속으로 매수 0건이면 그날은 포기한다.
  // 재배치 1회 = 에이전트 2개 + Manager 1개 = 전체 파이프라인 비용이다. 시장에 살 게
  // 없는 날 이걸 반복하면 아무 효과 없이 LLM 비용만 쌓인다 (2026-08-29 '재배치 3회 무행동').
  if ((p.noActionCount ?? 0) >= getRedeployMaxNoAction()) return false;

  // 규칙서 동시보유 상한에 이미 도달했으면 애초에 살 수 없다 — 비싼 파이프라인을 돌리기 전에 막는다.
  // (규칙서 12번: 동시 보유 최대 3종. REDEPLOY_MAX_POSITIONS로 맞춘다)
  if (p.openPositions !== undefined && p.openPositions >= getRedeployMaxPositions()) return false;

  return !p.pipelineRunning
    && p.msSinceLastDecision > cooldownMs  // 최근 결정 후 2시간 초과 (REDEPLOY_COOLDOWN_HOURS)
    && p.msToClose > 60 * 60 * 1000        // 마감까지 1시간 초과 남음
    && p.cashRatio >= threshold;           // 현금 비중 30% 이상 (REDEPLOY_CASH_RATIO)
}

/**
 * 두 에이전트(Claude·GPT)의 리포트가 '방금' 만들어져 재사용 가능한지 확인한다.
 *
 * 재시도에서 스크리닝·에이전트 단계를 건너뛰기 위한 판정이다. 기준은 두 가지:
 *  ① 두 리포트가 **모두** 있을 것 (한쪽만 있으면 Manager 입력이 반쪽이 된다)
 *  ② 둘 다 신선할 것 — 낡은 분석으로 매매를 결정하지 않는다
 *
 * @returns 재사용 가능하면 true
 */
async function hasFreshAgentReports(): Promise<boolean> {
  const maxAgeMs = (parseFloat(process.env.AGENT_REPORT_REUSE_MINUTES || '') || 90) * 60 * 1000;
  try {
    const dir = path.join(process.cwd(), 'data', 'report');
    const files = await fs.readdir(dir);
    for (const tag of ['weekly_agent_gpt.md', 'weekly_agent_claude.md']) {
      const latest = files.filter(f => f.endsWith(tag)).sort().pop();
      if (!latest) return false;
      const { mtimeMs } = await fs.stat(path.join(dir, latest));
      if (Date.now() - mtimeMs > maxAgeMs) return false;
    }
    return true;
  } catch {
    return false; // 확인 불가 = 재사용하지 않는다 (안전 방향: 다시 만든다)
  }
}

/** 재배치가 연속 '매수 0건'으로 끝날 수 있는 최대 횟수 (세션당). 초과하면 그날 재배치 중단. */
function getRedeployMaxNoAction(): number {
  const v = parseInt(process.env.REDEPLOY_MAX_NO_ACTION || '', 10);
  return Number.isFinite(v) && v > 0 ? v : 2;
}

/** 재배치를 시도할 동시보유 상한 — 규칙서의 동시 보유 제한과 같은 값으로 맞춘다. */
function getRedeployMaxPositions(): number {
  const v = parseInt(process.env.REDEPLOY_MAX_POSITIONS || '', 10);
  return Number.isFinite(v) && v > 0 ? v : 3;
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
export async function runReportPipeline(reportIdSuffix: string = '', reuseAgentReports = false): Promise<boolean> {
  if (pipelineRunning) {
    console.warn('⚠️ 리포트 파이프라인이 이미 실행 중입니다 — 이번 실행을 건너뜁니다.');
    return false;
  }
  pipelineRunning = true;
  const startedAt = Date.now();

  try {
    console.log(`🚀 리포트 파이프라인 시작 (에이전트 리포트 → Manager → 결정 집행)${reportIdSuffix ? ` [장중 재배치${reportIdSuffix}]` : ''}`);

    // 재시도 시 에이전트 리포트 재사용 — 파이프라인 비용의 약 2/3가 여기서 나온다
    // (전시장 스크리닝 + 에이전트 2개 LLM 호출). 실패는 대부분 Manager 단계에서 나므로
    // 몇 분 전에 성공한 리포트를 버리고 다시 만드는 건 순수한 낭비다.
    // 재사용은 '방금 만든 것'일 때만 — 낡은 분석으로 매매를 결정하지 않는다.
    const fresh = reuseAgentReports && (await hasFreshAgentReports());
    if (fresh) {
      console.log('♻️ 직전 에이전트 리포트 재사용 — 스크리닝·에이전트 단계 생략 (Manager만 재시도)');
    } else {
      await runWeekly();
    }
    await runManager(reportIdSuffix);

    // 사후 검증: 파이프라인의 목적은 "결정을 남기는 것"이다. 예외 없이 끝났다는 것만으로
    // 성공으로 간주하면, 내부 early-return이 조용히 전부를 건너뛴 경우를 잡지 못한다.
    // (2026-09-08: 휴장일 오판으로 weekly·manager가 즉시 반환했는데 로그 마지막 줄은
    //  "🎉 리포트 파이프라인 완료 (0초 소요)"였다. 그날 매매가 통째로 사라졌지만
    //  에러는 한 줄도 없었다.)
    // false를 반환하면 기존 재시도 경로를 그대로 태운다 — 새 복구 로직이 필요 없다.
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    const { getRecentDecisions } = await import('../services/decision');
    const expectedId = getKoreanDateString() + reportIdSuffix;
    const produced = (await getRecentDecisions(20)).some(d => d.report_id === expectedId);
    if (!produced) {
      console.error(
        `❌ 파이프라인이 예외 없이 끝났지만 결정(${expectedId})이 남지 않았습니다 (${elapsedSec}초 소요) — ` +
        `내부 단계가 조용히 건너뛰었을 가능성. 실패로 처리해 재시도합니다.`
      );
      return false;
    }

    console.log(`🎉 리포트 파이프라인 완료 (${elapsedSec}초 소요)`);
    return true;
  } catch (error) {
    console.error('❌ 리포트 파이프라인 실패:', error);
    return false;
  } finally {
    pipelineRunning = false;
  }
}

/**
 * 매분 틱: 리포트 트리거 판정 + 장중 SL/TP 감시
 */
async function tick(): Promise<void> {
  try {
    // 오류가 반복되다 멎으면 복구를 한 줄로 알린다 — 조용히 멎으면 복구인지 죽은 건지 모른다
    if (lastTickErrorKey) {
      console.log(`✅ 스케줄러 틱 복구 (직전 오류 ${tickErrorCount}회: ${lastTickErrorKey})`);
      lastTickErrorKey = ''; tickErrorCount = 0;
    }
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

    const now = Date.now();

    // 1) 정규장 중 매분: 체결 지연 자가 치유 → SL/TP 감시 → 현금 재배치
    //    ⚠️ 휴장일 early-return보다 **앞**에 있어야 한다. 토스 `today`는 한국 날짜
    //    기준이라 진행 중인 세션이 자정 이후엔 previousBusinessDay에 들어가고,
    //    미국 휴일이 걸린 한국 날짜에는 today.regular가 null이 되기 때문이다.
    //    (예전엔 today.regular 창으로 판정해 00:00~05:00 KST 감시가 통째로 죽었다 —
    //     세션의 77%. 2026-07-30 GPN TP1 미발동으로 발견)
    const activeSession = await getActiveRegularSession();
    if (activeSession && !watcherRunning) {
      await runIntradayWatch(activeSession, now);
    }

    const { today } = await getUsMarketCalendar(); // 10분 캐시 — 매분 호출해도 콜 낭비 없음
    if (!today.regular) return; // 휴장일 (개장 전 리포트 트리거만 스킵)
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
      if (reportRetryDate !== today.date) { reportRetryDate = today.date; reportRetryCount = 0; }
      lastReportDate = today.date;
      await saveState({ lastReportDate: today.date });
      console.log(`⏰ 개장 ${Math.round((today.regular.start - now) / 60000)}분 전 — 리포트 파이프라인 트리거 (영업일 ${today.date})`);
      // 실패 시 중복 방지 플래그를 되돌려 다음 틱이 재시도하게 한다.
      // 이미 집행까지 끝난 뒤의 실패라면 재실행돼도 isDecisionExecuted 가드가 이중 집행을 막는다.
      // 재시도(reportRetryCount > 0)에서는 직전 에이전트 리포트를 재사용해 비용을 줄인다
      void runReportPipeline('', reportRetryCount > 0).then(async ok => {
        if (ok) return;
        if (reportRetryCount >= MAX_REPORT_RETRIES) {
          console.error(`❌ 리포트 파이프라인 ${reportRetryCount + 1}회 실패 — 오늘(${today.date})은 더 재시도하지 않습니다.`);
          return;
        }
        reportRetryCount++;
        lastReportDate = '';
        await saveState({ lastReportDate: '' });
        console.warn(`🔁 파이프라인 실패 — 재시도 예약 (${reportRetryCount}/${MAX_REPORT_RETRIES}), 다음 틱에 재실행 (개장 전까지만)`);
      });
    }

  } catch (error: any) {
    // 같은 오류가 매분 반복되면 로그가 실제 신호를 덮는다 (2026-09-20 429 스톰에서
    // 수백 줄이 쌓여 정상 로그를 밀어냈다). 첫 발생과 5분 주기로만 남기고,
    // 복구되면 몇 번 만에 복구됐는지 한 줄로 알린다.
    const key = String(error.message).slice(0, 80);
    const nowMs = Date.now();
    if (key !== lastTickErrorKey || nowMs - lastTickErrorAt > 5 * 60 * 1000) {
      const repeat = key === lastTickErrorKey ? ` (같은 오류 ${tickErrorCount}회째)` : '';
      console.error(`⚠️ 스케줄러 틱 오류${repeat}:`, error.message);
      lastTickErrorAt = nowMs;
    }
    if (key === lastTickErrorKey) tickErrorCount++;
    else { lastTickErrorKey = key; tickErrorCount = 1; }
  }
}

/**
 * 장중 1회 처리: 체결 지연 자가 치유 → SL/TP 감시 → 현금 재배치 검사
 * - 동기화를 먼저 해야 방금 체결된 종목도 같은 틱에서 감시 대상이 된다
 * @param session 진행 중인 정규장 구간 (마감까지 남은 시간 계산에 사용)
 * @param now 이 틱의 기준 시각 (epoch ms)
 */
async function runIntradayWatch(session: { start: number; end: number }, now: number): Promise<void> {
  watcherRunning = true;
  try {
    await syncPendingFills();
    await checkPositionsOnce();
  } finally {
    watcherRunning = false;
  }

  // 장중 현금 재배치 (10분 간격 검사)
  // 조건: 현금 ≥30% + 마감 1시간+ 전 + 마지막 Manager 결정 후 2시간 초과.
  // 매매 직후 현금이 다시 30%를 넘어도 쿨다운이 지나면 재시도된다.
  if (new Date().getMinutes() % 10 !== 0) return;
  try {
    // 세션이 바뀌면 무행동 카운터 초기화 (전날 상한이 오늘을 막지 않도록)
    if (redeploySession !== session.start) {
      redeploySession = session.start;
      redeployNoActionCount = 0;
    }

    const msSinceLastDecision = now - (await getLastDecisionTime());
    const cheap = shouldRedeployCash({
      msToClose: session.end - now,
      cashRatio: 1, // 일단 통과값 — 비싼 API 검사는 아래에서
      msSinceLastDecision,
      pipelineRunning,
      noActionCount: redeployNoActionCount
    });
    if (!cheap) return;

    // 보유 종목 수는 로컬 파일 조회 — 비싼 잔고 API 전에 상한 도달 여부를 먼저 거른다
    const { getOpenPositions } = await import('../storage/positions');
    const { getRecentDecisions } = await import('../services/decision');
    const openCount = (await getOpenPositions()).length;
    const ratio = await getCashRatio();
    if (shouldRedeployCash({
      msToClose: session.end - now,
      cashRatio: ratio,
      msSinceLastDecision,
      pipelineRunning,
      openPositions: openCount,
      noActionCount: redeployNoActionCount
    })) {
      const hhmm = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit', minute: '2-digit' }).replace(':', '');
      const reportId = getKoreanDateString() + '-i' + hhmm;
      console.log(`💸 장중 현금 재배치 트리거: 현금 ${(ratio * 100).toFixed(0)}% ≥ 30%, 보유 ${openCount}종, 마지막 결정 후 ${Math.round(msSinceLastDecision / 3600000 * 10) / 10}시간, 마감까지 ${Math.round((session.end - now) / 60000)}분`);
      void runReportPipeline('-i' + hhmm).then(async () => {
        // 매수 0건으로 끝났으면 무행동으로 집계한다. 상한에 닿으면 그날 재배치를 멈춘다 —
        // 살 게 없는 날 전체 파이프라인을 반복하는 비용을 막는 안전핀.
        try {
          const bought = (await getRecentDecisions(10))
            .find(d => d.report_id === reportId)?.actions.some(a => a.action === 'BUY');
          if (bought) return;
          redeployNoActionCount++;
          const max = getRedeployMaxNoAction();
          console.warn(
            `💤 재배치 무행동 ${redeployNoActionCount}/${max} (매수 0건)` +
            (redeployNoActionCount >= max ? ' — 이번 세션 재배치를 중단합니다.' : '')
          );
        } catch (e) {
          console.warn('⚠️ 재배치 결과 확인 실패(무시):', (e as Error).message);
        }
      });
    }
  } catch (error: any) {
    console.warn('⚠️ 현금 재배치 검사 실패 (10분 후 재시도):', error.message);
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
