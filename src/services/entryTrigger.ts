import { db } from '../storage/database';
import { DecisionItem, ExecutionOutcome } from './decision';
import { getCandles } from './toss';

/**
 * 조건부 진입 (전일 종가 이하에서만 매수)
 *
 * 개장 직후 시장가 매수가 전날 급등분 꼭대기에서 체결되고, 1~4일 안에 조기경보·손절로
 * 끝나는 패턴이 반복됐다 (2026-10 신규 진입 6건 중 VIAV·KEYS·CDNS·PBF·GWRE 5건).
 * 그래서 BUY 결정은 즉시 사지 않고 '전일 종가 이하'라는 가격 조건을 건다.
 *
 * 토스는 금액(소수점) 주문을 MARKET으로만 받으므로 지정가 주문을 브로커에 걸 수 없다.
 * 대신 감시기가 매분 현재가를 보고 조건을 만족하는 순간 같은 금액의 시장가 주문을 낸다
 * (소프트웨어 지정가). 소수점 주문 마감(장 마감 1시간 전)까지 조건이 안 오면 만료되고,
 * 만료 사실은 집행 결과로 다음 사이클 Manager에게 전달된다 — 다음 결정은 백지에서 다시 한다.
 *
 * ENTRY_TRIGGER_MODE=off 로 끄면 예전처럼 개장 즉시 시장가 매수한다.
 */

const PENDING_FILE = 'pending_entries';

/** 조건 대기 중인 매수 1건 */
export interface PendingEntry {
  report_id: string;              // 이 매수를 낸 결정의 report_id
  item: DecisionItem;             // 원본 BUY 결정 (집행 시 그대로 사용)
  trigger_price: number;          // 현재가가 이 값 이하가 되면 매수
  trigger_basis: 'prev_close' | 'limit_price';
  session_start: number;          // 대기가 유효한 정규장 세션 시작 (epoch ms)
  expires_at: number;             // 만료 시각 = 소수점 주문 마감 (epoch ms)
  created_at: string;
}

/**
 * 조건부 진입 사용 여부
 * @returns ENTRY_TRIGGER_MODE가 'off'가 아니면 true (기본 켜짐)
 */
export function isEntryTriggerEnabled(): boolean {
  return (process.env.ENTRY_TRIGGER_MODE || '').toLowerCase() !== 'off';
}

/**
 * 미국 동부 기준 날짜 문자열 (YYYY-MM-DD)
 * @param ms epoch ms 또는 ISO 문자열
 */
function usDay(ms: number | string): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * 일봉 목록에서 '이번 세션 이전 마지막 종가'를 고른다 (순수 함수)
 * - 장중에는 오늘 봉(진행 중)이 섞여 오므로 미국 날짜로 오늘 봉을 제외한다.
 * @param candles 일봉 (순서 무관)
 * @param sessionStart 진행 중(또는 곧 열릴) 세션 시작 epoch ms
 * @returns 전일 종가, 없으면 undefined
 */
export function previousCloseBefore(
  candles: Array<{ date: string; close: number }>,
  sessionStart: number
): number | undefined {
  return lastConfirmedClose(candles, sessionStart)?.close;
}

/**
 * 기준 시각의 미국 날짜 이전 마지막 확정 종가와 그 날짜 (순수 함수)
 * - 만료 판정처럼 "어느 날 종가인지"까지 필요한 곳에서 쓴다.
 * @param candles 일봉 (순서 무관)
 * @param at 기준 시각 epoch ms (이 미국 날짜의 봉은 진행 중으로 보고 제외)
 * @returns { date: 미국 날짜 YYYY-MM-DD, close } 또는 undefined
 */
export function lastConfirmedClose(
  candles: Array<{ date: string; close: number }>,
  at: number
): { date: string; close: number } | undefined {
  const today = usDay(at);
  const prior = candles
    .filter(c => usDay(c.date) < today && c.close > 0)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const last = prior[prior.length - 1];
  return last ? { date: usDay(last.date), close: last.close } : undefined;
}

/**
 * 진입 기준가 결정 (순수 함수)
 * - 기본은 전일 종가. Manager가 LIMIT 가격을 줬으면 둘 중 낮은 값 — 지정가로 전일 종가
 *   위를 쫓아 사는 우회를 막는다.
 * @param item BUY 결정
 * @param prevClose 전일 종가
 */
export function resolveTrigger(item: DecisionItem, prevClose: number): { price: number; basis: PendingEntry['trigger_basis'] } {
  if (item.order_type === 'LIMIT' && item.limit_price && item.limit_price > 0 && item.limit_price < prevClose) {
    return { price: item.limit_price, basis: 'limit_price' };
  }
  return { price: prevClose, basis: 'prev_close' };
}

/**
 * 진입 조건 판정 (순수 함수)
 * @param price 현재가
 * @param trigger 기준가
 * @returns 현재가가 기준가 이하이면 true
 */
export function shouldFireEntry(price: number, trigger: number): boolean {
  return price > 0 && trigger > 0 && price <= trigger;
}

/**
 * 종목의 전일 종가 조회 (토스 일봉 1콜)
 * @param symbol 종목 심볼
 * @param sessionStart 세션 시작 epoch ms
 * @returns 전일 종가, 조회 실패 시 undefined
 */
export async function getPreviousClose(symbol: string, sessionStart: number): Promise<number | undefined> {
  const candles = await getCandles(symbol, '1d', 5);
  return previousCloseBefore(candles, sessionStart);
}

/**
 * 보유 종목의 마지막 확정 정규장 종가 조회 (Manager 입력용)
 * @param symbol 종목
 * @param at 기준 시각 epoch ms (기본 지금)
 * @returns { date, close } 또는 undefined (조회 실패 포함)
 */
export async function getLastConfirmedClose(symbol: string, at: number = Date.now()): Promise<{ date: string; close: number } | undefined> {
  try {
    const candles = await getCandles(symbol, '1d', 5);
    return lastConfirmedClose(candles, at);
  } catch {
    return undefined;
  }
}

/** 대기 목록 전체 조회 */
export async function getPendingEntries(): Promise<PendingEntry[]> {
  try {
    const all = await db.read<PendingEntry>(PENDING_FILE);
    return Array.isArray(all) ? all : [];
  } catch {
    return [];
  }
}

/**
 * 대기 목록에 추가 (같은 report_id·심볼이면 교체 — 파이프라인 재실행 시 중복 방지)
 * @param entry 추가할 대기 매수
 */
export async function addPendingEntry(entry: PendingEntry): Promise<void> {
  await db.withLock(PENDING_FILE, async () => {
    const all = (await getPendingEntries()).filter(
      e => !(e.report_id === entry.report_id && e.item.symbol === entry.item.symbol)
    );
    all.push(entry);
    await db.write(PENDING_FILE, all);
  });
}

/**
 * 대기 목록에서 제거
 * @param reportId 결정 report_id
 * @param symbol 종목 심볼
 */
export async function removePendingEntry(reportId: string, symbol: string): Promise<void> {
  await db.withLock(PENDING_FILE, async () => {
    const all = (await getPendingEntries()).filter(e => !(e.report_id === reportId && e.item.symbol === symbol));
    await db.write(PENDING_FILE, all);
  });
}

/**
 * 지금 유효한(이 세션·미만료) 대기가 있는지 — 장중 재배치가 대기 중인 매수와
 * 같은 현금·슬롯을 두고 새 결정을 내지 않도록 막는 데 쓴다.
 * @param sessionStart 진행 중 세션 시작 epoch ms
 * @param now 기준 시각
 */
export async function hasActivePendingEntries(sessionStart: number, now: number = Date.now()): Promise<boolean> {
  return (await getPendingEntries()).some(e => e.session_start === sessionStart && now < e.expires_at);
}

/**
 * 대기 매수의 집행 결과를 결정 기록에 반영한다 (PENDING → FILLED/REJECTED/EXPIRED)
 * - FILLED(실주문)면 executed_at도 세워 이중 집행 가드와 체결 동기화(syncPendingFills)가 보게 한다.
 * @param reportId 결정 report_id
 * @param outcome 새 결과
 * @param realFill 실주문 체결 여부 (dry-run이면 false)
 */
export async function updatePendingOutcome(reportId: string, outcome: ExecutionOutcome, realFill: boolean): Promise<void> {
  await db.withLock('decisions', async () => {
    const all = await db.read<any>('decisions');
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].report_id !== reportId) continue;
      const list: ExecutionOutcome[] = (all[i].execution_outcomes || []).filter(
        (o: ExecutionOutcome) => !(o.symbol === outcome.symbol && o.action === 'BUY')
      );
      list.push(outcome);
      all[i].execution_outcomes = list;
      if (realFill && !all[i].executed_at) all[i].executed_at = new Date().toISOString();
      break;
    }
    await db.write('decisions', all);
  });
}
