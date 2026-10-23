/**
 * entryQuality.ts — 진입 품질 측정 (주간회고 입력)
 *
 * 실현 원장은 '얼마에 끝났나'만 보여준다. 그래서 진입이 왜 실패했는지 — 고점 추격이었나,
 * 진입 직후부터 빠졌나, 올랐다가 반납했나 — 를 구분할 수 없었다 (2026-10 신규 진입 6건 중
 * 5건이 1~4일 만에 손실 청산). 진입 1건마다 일봉으로 다음을 잰다:
 *
 *  - 추격폭: 진입가 ÷ 전일 종가 − 1   (양수 = 전날보다 비싸게 샀다)
 *  - MFE / MAE: 보유 구간 최대 상승폭 / 최대 하락폭 (장중 고가·저가 기준)
 *  - 초기 3일 MAE: 진입 후 3거래일 안의 최대 하락폭 (진입 직후 실패 여부)
 *
 * 셋업 유형(CONTINUATION/PULLBACK/STEADY)별로 묶어 어떤 진입이 실제로 통하는지 보이게 한다.
 * 토스 일봉을 진입 1건당 1콜 조회하므로 서버 프로세스 안(주간회고)에서만 호출한다 —
 * 별도 프로세스에서 부르면 토큰 재발급으로 서버 토큰이 무효화된다.
 */

import { db } from '../storage/database';
import { getCandles } from './toss';
import { previousCloseBefore } from './entryTrigger';

/** 진입 1건 (보유 0 → 매수로 시작해 다시 0이 될 때까지) */
export interface EntryEpisode {
  symbol: string;
  entryAt: string;      // 첫 매수 시각
  entryPrice: number;   // 첫 매수 체결(추정)가
  exitAt?: string;      // 전량 청산 시각 (보유 중이면 없음)
  realizedPct?: number; // 매도대금 ÷ 매수대금 − 1 (%) — 청산 완료분만
}

/** 진입 1건의 측정값 */
export interface EntryQuality extends EntryEpisode {
  setup?: string;
  chasePct?: number;    // 진입가 vs 전일 종가 (%)
  mfePct: number;       // 보유 구간 최대 상승 (%)
  maePct: number;       // 보유 구간 최대 하락 (%)
  mae3Pct: number;      // 진입 후 3거래일 최대 하락 (%)
  mfe3Pct: number;      // 진입 후 3거래일 최대 상승 (%)
}

interface RawTrade { traded_at: string; symbol: string; side: 'BUY' | 'SELL'; qty: number; price: number; note?: string }

/**
 * 매매 기록 → 진입 에피소드 목록 (순수 함수)
 * - 종목별로 보유 수량을 따라가며 0에서 매수가 나오면 새 진입, 다시 0(먼지 이하)이 되면 청산
 * @param trades 시간순 무관 거래 목록
 * @returns 진입 에피소드 (진입 시각 오름차순)
 */
export function buildEpisodes(trades: RawTrade[]): EntryEpisode[] {
  // 감사 기록의 금액 매수 수량은 '금액 ÷ 현재가' 추정치라 실체결 수량과 몇 % 어긋난다.
  // 절대 먼지 기준(1e-4)으로는 전량 매도 후에도 잔량이 남아 진입이 영원히 안 닫힌다 —
  // 매수 수량의 3% 이하가 남으면 청산으로 본다.
  const DUST_RATIO = 0.03;
  const sorted = [...trades].sort((a, b) => new Date(a.traded_at).getTime() - new Date(b.traded_at).getTime());
  const open = new Map<string, { ep: EntryEpisode; qty: number; boughtQty: number; buyUsd: number; sellUsd: number }>();
  const out: EntryEpisode[] = [];
  for (const t of sorted) {
    if (!(t.qty > 0) || !(t.price > 0)) continue;
    let cur = open.get(t.symbol);
    if (t.side === 'BUY') {
      if (!cur) {
        cur = { ep: { symbol: t.symbol, entryAt: t.traded_at, entryPrice: t.price }, qty: 0, boughtQty: 0, buyUsd: 0, sellUsd: 0 };
        open.set(t.symbol, cur);
        out.push(cur.ep);
      }
      cur.qty += t.qty;
      cur.boughtQty += t.qty;
      cur.buyUsd += t.qty * t.price;
    } else if (cur) {
      const q = Math.min(t.qty, cur.qty);
      cur.qty -= q;
      cur.sellUsd += q * t.price;
      if (cur.qty <= cur.boughtQty * DUST_RATIO) {
        cur.ep.exitAt = t.traded_at;
        // 매도 수량 기준 원가로 나눈다 (잔량 오차가 결과를 왜곡하지 않도록)
        const soldCost = (cur.buyUsd / cur.boughtQty) * (cur.boughtQty - cur.qty);
        cur.ep.realizedPct = (cur.sellUsd / soldCost - 1) * 100;
        open.delete(t.symbol);
      }
    }
  }
  return out;
}

/**
 * 진입 1건을 일봉으로 측정 (순수 함수)
 * @param ep 진입 에피소드
 * @param candles 해당 종목 일봉 (진입 전후 포함)
 * @returns 측정값, 진입일 이후 봉이 없으면 null
 */
export function measureEpisode(
  ep: EntryEpisode,
  candles: Array<{ date: string; high: number; low: number; close: number }>
): Omit<EntryQuality, keyof EntryEpisode | 'setup'> | null {
  const usDay = (v: string | number) => new Date(v).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const from = usDay(ep.entryAt);
  const to = ep.exitAt ? usDay(ep.exitAt) : '9999-12-31';
  const held = candles
    .filter(c => { const d = usDay(c.date); return d >= from && d <= to && c.high > 0 && c.low > 0; })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (held.length === 0) return null;
  const pct = (v: number) => Math.round((v / ep.entryPrice - 1) * 1000) / 10;
  const first3 = held.slice(0, 3);
  const prevClose = previousCloseBefore(candles, new Date(ep.entryAt).getTime());
  return {
    chasePct: prevClose ? Math.round((ep.entryPrice / prevClose - 1) * 1000) / 10 : undefined,
    mfePct: pct(Math.max(...held.map(c => c.high))),
    maePct: pct(Math.min(...held.map(c => c.low))),
    mfe3Pct: pct(Math.max(...first3.map(c => c.high))),
    mae3Pct: pct(Math.min(...first3.map(c => c.low))),
  };
}

/** 평균 (빈 배열이면 NaN) */
function avg(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
}

/** 부호 붙인 퍼센트 문자열 */
function fmt(v: number | undefined): string {
  if (v === undefined || !isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

/**
 * 최근 진입들의 품질 측정 → 주간회고 입력용 마크다운
 * @param days 조회 기간 (진입일 기준, 기본 56일 = 8주)
 * @returns 표 + 셋업별·결과별 요약
 */
export async function buildEntryQuality(days: number = 56): Promise<string> {
  const trades = await db.read<RawTrade>('trades');
  const decisions = await db.read<any>('decisions');
  const cutoff = Date.now() - days * 86400_000;
  const episodes = buildEpisodes(trades.filter(t => !/dry/i.test(t.note || '')))
    .filter(e => new Date(e.entryAt).getTime() >= cutoff);
  if (episodes.length === 0) return `최근 ${days}일 진입 없음.`;

  /** 진입 직전 결정에서 셋업 태그를 찾는다 (진입 시각 기준 3일 이내 BUY 결정) */
  const setupOf = (ep: EntryEpisode): string | undefined => {
    const t = new Date(ep.entryAt).getTime();
    const cands = decisions
      .filter((d: any) => { const dt = new Date(d.decided_at).getTime(); return dt <= t && t - dt < 3 * 86400_000; })
      .sort((a: any, b: any) => new Date(b.decided_at).getTime() - new Date(a.decided_at).getTime());
    for (const d of cands) {
      const a = (d.actions || []).find((x: any) => x.action === 'BUY' && x.symbol === ep.symbol);
      if (a) return a.setup;
    }
    return undefined;
  };

  const rows: EntryQuality[] = [];
  for (const ep of episodes) {
    try {
      const candles = await getCandles(ep.symbol, '1d', 120);
      const m = measureEpisode(ep, candles);
      if (m) rows.push({ ...ep, ...m, setup: setupOf(ep) });
    } catch (e: any) {
      console.warn(`⚠️ 진입 품질 측정 실패 ${ep.symbol}: ${e.message}`);
    }
  }
  if (rows.length === 0) return '진입 품질 측정 실패 (일봉 조회 불가).';

  const kst = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).slice(5);
  const table = [
    '| 진입일 | 종목 | 셋업 | 추격폭(전일종가 대비) | 초기3일 MAE / MFE | 보유 MAE / MFE | 결과 |',
    '|---|---|---|---:|---:|---:|---:|',
    ...rows.map(r => `| ${kst(r.entryAt)} | ${r.symbol} | ${r.setup || '—'} | ${fmt(r.chasePct)} | ${fmt(r.mae3Pct)} / ${fmt(r.mfe3Pct)} | ${fmt(r.maePct)} / ${fmt(r.mfePct)} | ${r.exitAt ? fmt(r.realizedPct) : '보유 중'} |`)
  ].join('\n');

  const closed = rows.filter(r => r.exitAt);
  const wins = closed.filter(r => (r.realizedPct ?? 0) > 0);
  const losses = closed.filter(r => (r.realizedPct ?? 0) <= 0);
  const chase = (xs: EntryQuality[]) => fmt(avg(xs.map(r => r.chasePct).filter((v): v is number => v !== undefined)));
  const earlyFail = rows.filter(r => r.mae3Pct <= -3 && r.mfe3Pct < 3).length;

  const bySetup = new Map<string, EntryQuality[]>();
  for (const r of closed) (bySetup.get(r.setup || '미기재') || bySetup.set(r.setup || '미기재', []).get(r.setup || '미기재')!).push(r);
  const setupLines = [...bySetup.entries()].map(([s, xs]) =>
    `- ${s}: ${xs.length}건, 승 ${xs.filter(r => (r.realizedPct ?? 0) > 0).length}, 평균 결과 ${fmt(avg(xs.map(r => r.realizedPct ?? 0)))}, 평균 추격폭 ${chase(xs)}, 평균 MFE ${fmt(avg(xs.map(r => r.mfePct)))}`);

  return [
    table,
    '',
    `- 청산 ${closed.length}건: 이긴 진입 평균 추격폭 ${chase(wins)} vs 진 진입 ${chase(losses)}`,
    `- 진입 직후 실패(3거래일 안에 −3% 이하, 그동안 +3% 미만): ${earlyFail}/${rows.length}건`,
    `- 진 진입의 평균 보유 MFE ${fmt(avg(losses.map(r => r.mfePct)))} (높으면 '올랐다가 반납', 낮으면 '처음부터 틀린 진입')`,
    ...setupLines,
    '- 측정 기준: 진입가는 감사 기록의 추정 체결가, MAE/MFE는 일봉 고가·저가. 10/24부터 신규 진입은 전일 종가 이하에서만 체결된다(조건부 진입) — 그 전후 추격폭을 비교하라.',
  ].join('\n');
}
