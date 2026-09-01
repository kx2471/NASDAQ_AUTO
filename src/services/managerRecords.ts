/**
 * managerRecords.ts — Manager에게 주입할 "기록 스트림" 생성기.
 *
 * Manager가 더 많은 정보·기록을 보고 판단하도록, 시스템이 이미 쌓아둔 데이터를
 * '증류'해서(날것 X, 신호 O) 컨텍스트 문자열로 만든다. 리포트 출력 양식은 무관 —
 * 오직 Manager의 입력(user 메시지)을 풍부하게 하는 용도.
 *
 *  ① buildRealizedLedger      — 실현 손익 원장 (완료 매매의 승률·평균폭·보유일)
 *  ② buildPerformanceTrajectory — 자산 궤적 + 목표 페이스
 *  ③ buildDecisionOutcomes     — 지난 결정 → 실제 결과(실현/보유지속) 연결
 *  저널 readJournal / appendJournalFromReport — Manager가 매 사이클 읽고 한 줄 교훈을 남김
 */

import fs from 'fs/promises';
import path from 'path';
import { getRecentDecisions } from './decision';

const DATA_DIR = path.join(process.cwd(), 'data/json');
const JOURNAL_PATH = path.join(process.cwd(), 'data/report/manager_journal.md');
// 학습된 매매 규칙서(플레이북) — 저널(append-only 날것)과 달리 주간회고가 '통째로 재작성'하는 살아있는 규칙집.
const PLAYBOOK_PATH = path.join(process.cwd(), 'data/report/manager_playbook.md');
const PLAYBOOK_HISTORY_DIR = path.join(process.cwd(), 'data/report/playbook_history');
// 자기수정 무한팽창 방지 코드 캡 — LLM이 규칙서를 아무리 부풀려도 이 길이에서 잘린다(안전핀).
const PLAYBOOK_MAX_CHARS = 4000;

interface RawTrade {
  traded_at: string; symbol: string; side: 'BUY' | 'SELL'; qty: number; price: number; note?: string;
}
/** 청산 사유 — SELL 주문의 note에서 분류 (watcher/Manager가 남기는 형식 기반) */
type ExitReason = '손절발동' | 'TP1익절' | 'TP2익절' | 'Manager매도' | '기타';

interface RoundTrip {
  symbol: string; buyAvg: number; sellPrice: number; qty: number;
  buyDate: string; sellDate: string; holdDays: number; realizedPct: number;
  exitReason: ExitReason;
}

/** SELL note → 청산 사유 분류. watcher는 "손절:/1차 익절:/2차 익절:", Manager는 "Manager 결정 매도"로 시작. */
function classifyExit(note: string | undefined): ExitReason {
  const n = note || '';
  if (n.startsWith('손절')) return '손절발동';
  if (n.startsWith('1차 익절')) return 'TP1익절';
  if (n.startsWith('2차 익절')) return 'TP2익절';
  if (n.includes('Manager 결정 매도')) return 'Manager매도';
  return '기타';
}

/**
 * 현재 자동매매 시스템의 가동 시작일 (KST). 이전 기록은 학습 대상에서 제외한다.
 *
 * trades.json에는 2025-09~12월 구 시스템(수동/GitHub Actions 시절, 다른 프롬프트·
 * 다른 모델·다른 집행 방식) 기록 123건이 남아 있다. 이걸 섞어 통계를 내면
 * Manager가 자기 성적을 오판한다 — 실측(2026-08-28): 혼합 시 승률 47%·"기타 55건
 * 평균 +1.9%"로 보이지만, 현재 시스템만 보면 승률 34%·금액가중 -1.70%다.
 * 6주간 규칙서가 "데이터로 확인됐다"며 인용해 온 근거의 상당수가 구 시스템 것이었다.
 */
const SYSTEM_START_AT = '2026-07-13T00:00:00+09:00';

/** 현재 시스템 가동 이후의 거래만 남긴다 (학습 통계 오염 차단). */
function onlyCurrentSystem<T extends { traded_at: string }>(rows: T[]): T[] {
  const cutoff = new Date(SYSTEM_START_AT).getTime();
  return rows.filter(r => new Date(r.traded_at).getTime() >= cutoff);
}

/** JSON 파일을 안전하게 배열로 읽는다 (없거나 깨지면 빈 배열). */
async function readJsonArray<T>(file: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, `${file}.json`), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/**
 * trades.json → 완료된 왕복매매(round-trip) 재구성 (종목별 FIFO 매칭).
 * 매수 로트를 시간순 큐에 쌓고, 매도 시 오래된 로트부터 수량만큼 소진하며 실현손익을 계산한다.
 * @returns 청산 시각 오름차순 round-trip 배열
 */
function reconstructRoundTrips(trades: RawTrade[]): RoundTrip[] {
  const bySymbol = new Map<string, RawTrade[]>();
  for (const t of trades) {
    if (!t || (t.side !== 'BUY' && t.side !== 'SELL')) continue;
    (bySymbol.get(t.symbol) || bySymbol.set(t.symbol, []).get(t.symbol)!).push(t);
  }
  const trips: RoundTrip[] = [];
  for (const [symbol, list] of bySymbol) {
    list.sort((a, b) => new Date(a.traded_at).getTime() - new Date(b.traded_at).getTime());
    const lots: Array<{ qty: number; price: number; date: string }> = []; // FIFO 매수 로트
    for (const t of list) {
      if (t.side === 'BUY') {
        if (t.qty > 0) lots.push({ qty: t.qty, price: t.price, date: t.traded_at });
      } else { // SELL — 오래된 로트부터 매칭
        let remaining = t.qty;
        let matchedQty = 0, costSum = 0, weightedDays = 0;
        while (remaining > 1e-9 && lots.length > 0) {
          const lot = lots[0];
          const take = Math.min(lot.qty, remaining);
          matchedQty += take;
          costSum += take * lot.price;
          weightedDays += take * Math.max(0, (new Date(t.traded_at).getTime() - new Date(lot.date).getTime()) / 86400000);
          lot.qty -= take;
          remaining -= take;
          if (lot.qty <= 1e-9) lots.shift();
        }
        if (matchedQty > 1e-9) {
          const buyAvg = costSum / matchedQty;
          trips.push({
            symbol, qty: matchedQty, buyAvg, sellPrice: t.price,
            buyDate: '', sellDate: t.traded_at,
            holdDays: Math.round(weightedDays / matchedQty),
            realizedPct: buyAvg > 0 ? ((t.price - buyAvg) / buyAvg) * 100 : 0,
            exitReason: classifyExit(t.note),
          });
        }
      }
    }
  }
  return trips.sort((a, b) => new Date(a.sellDate).getTime() - new Date(b.sellDate).getTime());
}

/** ① 실현 손익 원장 — 완료 매매의 승률·평균 익절/손절폭·평균 보유일 + 최근 청산 표. */
export async function buildRealizedLedger(): Promise<string> {
  const trades = onlyCurrentSystem(await readJsonArray<RawTrade>('trades'));
  const trips = reconstructRoundTrips(trades);
  if (trips.length === 0) return '완료된(청산) 매매 없음 — 아직 실현 손익 이력 없음. 첫 회전 매매의 결과가 여기 쌓인다.';

  const wins = trips.filter(t => t.realizedPct > 0);
  const losses = trips.filter(t => t.realizedPct <= 0);
  const avg = (arr: RoundTrip[]) => arr.length ? arr.reduce((s, t) => s + t.realizedPct, 0) / arr.length : 0;
  const avgHold = trips.reduce((s, t) => s + t.holdDays, 0) / trips.length;
  const winRate = (wins.length / trips.length) * 100;

  // 청산 사유별 내역 — "어떻게 끝났나"까지 보여줘 SL/TP 설정의 자기교정에 쓰이게 한다.
  // 예: 손절발동 비율이 높으면 SL을 너무 타이트하게 잡고 있다는 신호.
  const byReason = new Map<ExitReason, RoundTrip[]>();
  for (const t of trips) (byReason.get(t.exitReason) || byReason.set(t.exitReason, []).get(t.exitReason)!).push(t);
  const reasonLine = ['손절발동', 'TP1익절', 'TP2익절', 'Manager매도', '기타']
    .filter(r => byReason.has(r as ExitReason))
    .map(r => {
      const arr = byReason.get(r as ExitReason)!;
      return `${r} ${arr.length}건(평균 ${avg(arr) >= 0 ? '+' : ''}${avg(arr).toFixed(1)}%)`;
    }).join(' · ');

  // 셋업별 성과 — 진입 로직 재설계(2026-08-29)의 핵심 산출물.
  // 세 셋업을 동시에 공급한 이유가 "어느 유형이 통하는지"를 원장이 답하게 하려는 것이므로,
  // 여기서 갈라 보여줘야 회고가 근거 있는 비교를 할 수 있다.
  // 셋업 태그는 decisions.json의 BUY 액션에 있으므로 심볼+시점으로 매칭한다.
  let setupLine = '';
  try {
    const decisions = await getRecentDecisions(60);
    const buys: Array<{ symbol: string; at: number; setup: string }> = [];
    for (const d of decisions) {
      for (const a of d.actions) {
        if (a.action === 'BUY' && (a as any).setup) {
          buys.push({ symbol: a.symbol, at: new Date(d.decided_at).getTime(), setup: (a as any).setup });
        }
      }
    }
    const setupOf = (t: RoundTrip): string | null => {
      const sold = new Date(t.sellDate).getTime();
      const cand = buys.filter(b => b.symbol === t.symbol && b.at <= sold).sort((x, y) => y.at - x.at);
      return cand.length ? cand[0].setup : null;
    };
    const bySetup = new Map<string, RoundTrip[]>();
    for (const t of trips) {
      const s = setupOf(t);
      if (s) (bySetup.get(s) || bySetup.set(s, []).get(s)!).push(t);
    }
    if (bySetup.size > 0) {
      const parts = ['CONTINUATION', 'PULLBACK', 'STEADY']
        .filter(s => bySetup.has(s))
        .map(s => {
          const arr = bySetup.get(s)!;
          const w = arr.filter(t => t.realizedPct > 0).length;
          return `${s} ${arr.length}건(승률 ${Math.round(w / arr.length * 100)}% · 평균 ${avg(arr) >= 0 ? '+' : ''}${avg(arr).toFixed(1)}%)`;
        });
      const tagged = [...bySetup.values()].reduce((s, a) => s + a.length, 0);
      setupLine = `셋업별 성과(태그된 ${tagged}/${trips.length}건): ${parts.join(' · ')}`;
    } else {
      setupLine = '셋업별 성과: 태그된 청산 없음 — 2026-08-31 이후 신규 진입부터 집계된다.';
    }
  } catch {
    setupLine = '셋업별 성과: 집계 실패.';
  }

  const kst = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const recent = trips.slice(-12).reverse().map(t => {
    const sign = t.realizedPct >= 0 ? '+' : '';
    return `  ${t.symbol}: $${t.buyAvg.toFixed(2)}→$${t.sellPrice.toFixed(2)} · ${t.holdDays}일 보유 · 실현 ${sign}${t.realizedPct.toFixed(1)}% · ${t.exitReason} (청산 ${kst(t.sellDate)})`;
  }).join('\n');

  return [
    `총 청산 ${trips.length}건 · 승률 ${winRate.toFixed(0)}% (승 ${wins.length}/패 ${losses.length}) · ` +
    `평균 익절 +${avg(wins).toFixed(1)}% · 평균 손절 ${avg(losses).toFixed(1)}% · 평균 보유 ${avgHold.toFixed(0)}일`,
    `청산 사유별: ${reasonLine}`,
    setupLine,
    `최근 청산 매매:`,
    recent,
  ].join('\n');
}

/** ② 자산 궤적 + 목표 페이스 — performance_history.json + 목표/시작일(env). */
export async function buildPerformanceTrajectory(): Promise<string> {
  const hist = await readJsonArray<any>('performance_history');
  if (hist.length === 0) return '성과 기록 없음.';
  // 이상치 제거: 초기대비 |수익률|>50%는 스냅샷 글리치(예: 토스가 잠깐 빈 보유 반환).
  // 원본 파일은 건드리지 않고 표시·페이스 계산에서만 제외한다.
  const clean = [...hist]
    .filter(d => Math.abs(d.total_return_from_initial_percent ?? 0) <= 50)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (clean.length === 0) return '성과 기록 없음(유효 데이터 없음).';
  const latest = clean[clean.length - 1];
  const anomalies = hist.length - clean.length;

  // 목표 페이스: 초기자본이 이미 목표의 일부(start_pct)임을 반영한 선형 기대치와 비교한다.
  //  expected = start_pct + (100-start_pct) × 경과일/365.  0%에서 시작한다고 보면 페이스를 과대평가한다.
  const startStr = process.env.INVEST_START_DATE;
  const initialKrw = parseFloat(process.env.INITIAL_CAPITAL_KRW || '');
  const targetKrw = parseFloat(process.env.TARGET_AMOUNT_KRW || '');
  let paceLine = '';
  if (startStr && Number.isFinite(latest.target_progress) && initialKrw > 0 && targetKrw > 0) {
    const elapsedDays = Math.max(0, (Date.now() - new Date(startStr).getTime()) / 86400000);
    const startPct = (initialKrw / targetKrw) * 100;                    // 시작 기준선(%)
    const expected = startPct + (100 - startPct) * Math.min(1, elapsedDays / 365);
    const actual = latest.target_progress;                              // 목표 대비 실제 진척(%)
    const delta = actual - expected;
    const verdict = delta >= 0
      ? `페이스 +${delta.toFixed(1)}%p 앞섬 (여유 — 무리한 리스크 불필요)`
      : `페이스 ${delta.toFixed(1)}%p 뒤처짐 (목표 달성하려면 더 공격적 필요)`;
    paceLine = `목표 페이스: 경과 ${elapsedDays.toFixed(0)}일 · 시작기준 ${startPct.toFixed(1)}% → 기대 ${expected.toFixed(1)}% vs 실제 ${actual.toFixed(1)}% → ${verdict}`;
  }

  const recent = clean.slice(-7).map(d =>
    `  ${d.date}: 초기대비 ${d.total_return_from_initial_percent >= 0 ? '+' : ''}${(d.total_return_from_initial_percent ?? 0).toFixed(2)}%`
  ).join('\n') + (anomalies > 0 ? `\n  (이상치 ${anomalies}건 제외됨 — 스냅샷 글리치)` : '');

  return [
    `초기자본 대비 현재: ${latest.total_return_from_initial_percent >= 0 ? '+' : ''}${(latest.total_return_from_initial_percent ?? 0).toFixed(2)}% · 목표 진척 ${(latest.target_progress ?? 0).toFixed(1)}%`,
    paceLine,
    `최근 자산 추이:`,
    recent,
  ].filter(Boolean).join('\n');
}

/**
 * ③ 지난 결정 → 실제 결과 연결.
 * 최근 결정들의 체결(FILLED)이 그 후 어떻게 됐는지를 붙인다:
 *  - 이후 청산됐으면 실현 수익률, 아직 보유 중이면 "보유 지속".
 * 현재가 호출 없이 trades.json 재구성만으로 판단한다.
 */
export async function buildDecisionOutcomes(): Promise<string> {
  const [decisions, trades] = await Promise.all([
    getRecentDecisions(6),
    readJsonArray<RawTrade>('trades').then(onlyCurrentSystem),
  ]);
  const withOutcomes = decisions.filter(d => d.execution_outcomes && d.execution_outcomes.length > 0);
  if (withOutcomes.length === 0) return '집행 결과 기록 없음 (첫 실집행 대기).';

  const trips = reconstructRoundTrips(trades);
  const kst = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

  return withOutcomes.slice(0, 5).map(d => {
    const decidedMs = new Date(d.decided_at).getTime();
    const lines = (d.execution_outcomes || []).map(o => {
      if (o.status === 'REJECTED') return `  ❌ ${o.action} ${o.symbol} 거부: ${o.reason || '사유 불명'}`;
      if (o.status !== 'FILLED') return `  ⏸️ ${o.symbol} HOLD (미집행)`;
      // 체결됨 → 이 결정 이후 같은 종목이 청산됐는지 확인
      const closedAfter = trips.filter(t => t.symbol === o.symbol && new Date(t.sellDate).getTime() >= decidedMs - 3600_000);
      if (o.action === 'BUY' && closedAfter.length > 0) {
        const t = closedAfter[closedAfter.length - 1];
        const sign = t.realizedPct >= 0 ? '+' : '';
        return `  ✅ BUY ${o.symbol} 체결 → 이후 청산: ${sign}${t.realizedPct.toFixed(1)}% (${t.holdDays}일 보유)`;
      }
      if (o.action === 'SELL' && closedAfter.length > 0) {
        const t = closedAfter[closedAfter.length - 1];
        const sign = t.realizedPct >= 0 ? '+' : '';
        return `  ✅ SELL ${o.symbol} 체결 → 실현 ${sign}${t.realizedPct.toFixed(1)}%`;
      }
      return `  ✅ ${o.action} ${o.symbol} 체결 → 보유 지속(미청산)`;
    });
    return `[${d.report_id} · ${kst(d.decided_at)}]\n${lines.join('\n')}`;
  }).join('\n');
}

/**
 * 이번 주 결정 로그 — 종목별 액션과 **당시 제시한 근거 원문**.
 *
 * 주간회고의 '규칙 준수 감사'가 자기 정당화를 검증하려면 근거 텍스트가 있어야 한다.
 * buildDecisionOutcomes는 체결 결과만 주므로 "왜 그렇게 판단했는지"가 빠져 있어,
 * 감사를 지시해도 회고가 추측으로 답하게 된다 (2026-08-09 회고가 규칙3 위반을
 * 적발하지 못하고 오히려 상한을 완화한 배경).
 *
 * @param days 조회 기간(일). 기본 8일 — 주간회고가 한 주를 온전히 덮도록
 * @returns 결정별 액션·근거 요약 (없으면 안내 문구)
 */
export async function buildDecisionRationales(days: number = 8): Promise<string> {
  const decisions = await getRecentDecisions(20);
  const cutoff = Date.now() - days * 86400000;
  const recent = decisions.filter(d => new Date(d.decided_at).getTime() >= cutoff);
  if (recent.length === 0) return '기간 내 결정 없음.';

  const kst = (iso: string) => new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });

  // 오래된 순으로 — 규칙 위반 판정은 시간 흐름을 따라가야 "그 시점 규칙"과 대조할 수 있다
  return recent
    .slice()
    .sort((a, b) => new Date(a.decided_at).getTime() - new Date(b.decided_at).getTime())
    .map(d => {
      // HOLD는 감사 가치가 낮아 심볼만, BUY/SELL은 근거 원문을 붙인다
      const moves = d.actions.filter(a => a.action !== 'HOLD');
      const holds = d.actions.filter(a => a.action === 'HOLD').map(a => a.symbol);
      const lines = moves.map(a =>
        `  ${a.action} ${a.symbol}${a.amount ? ` $${a.amount}` : ''}${a.qty ? ` ${a.qty}주` : ''}\n` +
        `    근거: ${(a.rationale || '(없음)').trim()}`
      );
      if (holds.length) lines.push(`  HOLD: ${holds.join(', ')}`);
      return `[${d.report_id} · ${kst(d.decided_at)}]\n${lines.join('\n') || '  (액션 없음)'}`;
    })
    .join('\n\n');
}

/**
 * 규칙 판정에 필요한 "확정 사실" 블록.
 *
 * 모델이 일반 상식으로 추론하다 틀리는 항목을 시스템이 계산해 못박는다.
 * 계기: 2026-08-07 Manager가 "금요일 야간 주문은 다음 거래일(월) 시가 체결"이라 오인해
 * 주간 매수 상한(규칙3, 2건)을 3건으로 넘겼다. 실제로는 그날 22:30 세션에 즉시 체결됐다.
 * 추론 능력 문제가 아니라 **시스템이 알려주지 않은 정보**였으므로 입력으로 해결한다.
 *
 * @returns 이번 주(KST 월요일 기준) 매수 집행 내역 + 주문/체결 타이밍 사실
 */
export async function buildTradingWindowFacts(): Promise<string> {
  const kstDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });          // YYYY-MM-DD
  const kstWd = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' });

  // 이번 주 월요일(KST) 날짜 문자열 — KST는 서머타임이 없어 일 단위 뺄셈이 안전하다
  const now = new Date();
  const wdIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(kstWd(now));
  const backDays = wdIdx === 0 ? 6 : wdIdx - 1;
  const monday = kstDate(new Date(now.getTime() - backDays * 86400000));

  const trades = await readJsonArray<RawTrade>('trades');
  const weekBuys = trades.filter(t => t.side === 'BUY' && kstDate(new Date(t.traded_at)) >= monday);
  const list = weekBuys.length
    ? weekBuys.map(t => `  - ${kstDate(new Date(t.traded_at))}(${kstWd(new Date(t.traded_at))}) ${t.symbol} @$${t.price}`).join('\n')
    : '  (없음)';

  // 일일 매수 여력 — 현금과 별개로 걸리는 제약이라 모르면 매번 거부당한다.
  // (2026-08-14 CRDO: 현금 $330을 보고 $295를 요청했으나 남은 여력은 $133이었다)
  // ⚠️ 기준은 '집행이 일어날 세션'이다. 파이프라인은 개장 40분 전에 도는데
  // 그때 "이미 시작된 세션"을 쓰면 어제 매수액이 차감돼 여력을 과소 보고한다.
  let dailyLine = '';
  try {
    const { getRemainingDailyBuyUsd } = await import('./trading');
    const { getExecutionSessionStart } = await import('./toss');
    const sessionStart = await getExecutionSessionStart();
    const remaining = await getRemainingDailyBuyUsd(sessionStart ?? undefined);
    dailyLine = `**이번 세션 남은 매수 여력: $${remaining.toFixed(2)}** — 보유 현금과 별개 제약이다. ` +
      `이 금액을 넘겨 요청하면 집행기가 이 금액으로 축소하므로, 배분은 처음부터 이 안에서 계획하라.`;
  } catch {
    dailyLine = '남은 매수 여력 조회 실패 — 보수적으로 배분할 것.';
  }

  return [
    `오늘: ${kstDate(now)}(${kstWd(now)}, KST 기준) · 이번 주 시작: ${monday}(Mon)`,
    dailyLine,
    `**이번 주 매수 집행 ${weekBuys.length}건** — 규칙3(주간 상한) 판정은 이 숫자를 그대로 쓸 것:`,
    list,
    `주문·체결 타이밍(확정 사실, 추론하지 말 것):`,
    `  - 이 시스템은 **정규장 개장 시각에 주문을 전송**하고 주문은 **같은 세션에 즉시 체결**된다.`,
    `  - 따라서 금요일 밤(KST) 주문도 그날 미국 금요일 정규장에 체결된다 — 다음 주로 넘어가지 않는다.`,
    `  - 주간 카운터는 **KST 월요일 00:00**에 리셋된다. 매도는 카운터를 되돌리지 않는다.`,
  ].join('\n');
}

/** 영속 저널 — 최근 교훈 N개를 텍스트로 반환 (없으면 안내). */
export async function readJournal(limit: number = 30): Promise<string> {
  try {
    const raw = await fs.readFile(JOURNAL_PATH, 'utf-8');
    const entries = raw.split(/\n(?=## )/).filter(s => s.trim()); // "## " 단위 분할
    if (entries.length === 0) return '저널 비어 있음 — 이번 사이클부터 교훈을 남긴다.';
    return entries.slice(-limit).join('\n');
  } catch { return '저널 비어 있음 — 이번 사이클부터 교훈을 남긴다.'; }
}

/**
 * 학습된 매매 규칙서(플레이북) 읽기 — 일일 Manager에 '최우선 신호'로 주입한다.
 *
 * 저널이 매일 쌓이는 날것 관찰이라면, 규칙서는 그걸 증류해 검증된 것만 규칙으로 승격한 결과다.
 * 갱신 주체는 주간회고(replacePlaybookFromReview) 하나뿐 — 일일 Manager는 읽기만 한다.
 * @returns 규칙서 본문 (없으면 안내 문구)
 */
export async function readPlaybook(): Promise<string> {
  try {
    const raw = (await fs.readFile(PLAYBOOK_PATH, 'utf-8')).trim();
    return raw || '아직 규칙서 없음 — 첫 주간회고가 저널·실현원장을 증류해 규칙을 세운다.';
  } catch {
    return '아직 규칙서 없음 — 첫 주간회고가 저널·실현원장을 증류해 규칙을 세운다.';
  }
}

/**
 * 주간회고 리포트에서 [PLAYBOOK]…[/PLAYBOOK] 블록을 뽑아 규칙서를 통째로 교체한다.
 *
 * ⚠️ 이것이 "프롬프트 자기수정"의 유일한 실체다. 안전 경계:
 *  - 갱신 대상은 '조언 계층'인 규칙서 파일 하나뿐. 헌법(promptManagerSimple.md)·
 *    가드레일(trading.ts 주문 한도·dry-run)은 이 함수가 손대지 못한다.
 *  - 교체 전 기존 규칙서를 playbook_history/에 타임스탬프 백업 → 나쁜 규칙 롤백·diff 가능.
 *  - PLAYBOOK_MAX_CHARS 초과분은 잘라 저장 → 자기수정 무한팽창을 코드에서 캡.
 * @returns 새 규칙서 본문(헤더 포함), 블록 없으면 null(기존 규칙서 유지)
 */
export async function replacePlaybookFromReview(reviewId: string, reviewContent: string): Promise<string | null> {
  const m = reviewContent.match(/\[PLAYBOOK\]\s*([\s\S]*?)\[\/PLAYBOOK\]/);
  if (!m) return null;
  let body = m[1].trim();
  if (!body) return null;
  if (body.length > PLAYBOOK_MAX_CHARS) {
    console.warn(`⚠️ 규칙서 상한 초과(${body.length}>${PLAYBOOK_MAX_CHARS}자) — 잘라서 저장`);
    body = body.slice(0, PLAYBOOK_MAX_CHARS);
  }
  const dateKst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  try {
    // 기존 규칙서 백업 (있을 때만) — 롤백·이력 추적용
    if (await fileExists(PLAYBOOK_PATH)) {
      await fs.mkdir(PLAYBOOK_HISTORY_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
      const prev = await fs.readFile(PLAYBOOK_PATH, 'utf-8');
      await fs.writeFile(path.join(PLAYBOOK_HISTORY_DIR, `manager_playbook_${stamp}.md`), prev, 'utf-8');
    }
    const doc = `<!-- 자동 생성: ${reviewId} · ${dateKst} 주간회고가 증류. 직접 수정 금지(다음 회고에 덮어씀) -->\n# 🎯 Manager 학습 규칙서 (${dateKst} 갱신)\n\n${body}\n`;
    await fs.mkdir(path.dirname(PLAYBOOK_PATH), { recursive: true });
    await fs.writeFile(PLAYBOOK_PATH, doc, 'utf-8');
    return doc;
  } catch (e) {
    console.error('⚠️ 규칙서 교체 실패:', (e as Error).message);
    return null;
  }
}

/**
 * Manager 리포트에서 [JOURNAL] 마커 한 줄을 뽑아 영속 저널에 append.
 * 리포트에 마커가 없으면 조용히 넘어간다(양식 강제 아님).
 * @returns append한 교훈 문자열 (없으면 null)
 */
export async function appendJournalFromReport(reportId: string, reportContent: string): Promise<string | null> {
  const m = reportContent.match(/\[JOURNAL\]\s*(.+)/);
  if (!m) return null;
  const lesson = m[1].trim();
  if (!lesson) return null;
  const dateKst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const entry = `## [${reportId}] ${dateKst}\n${lesson}\n`;
  try {
    await fs.mkdir(path.dirname(JOURNAL_PATH), { recursive: true });
    await fs.appendFile(JOURNAL_PATH, (await fileExists(JOURNAL_PATH) ? '\n' : '') + entry, 'utf-8');
    return lesson;
  } catch (e) {
    console.error('⚠️ 저널 append 실패:', (e as Error).message);
    return null;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
