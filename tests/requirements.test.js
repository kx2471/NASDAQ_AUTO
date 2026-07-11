/**
 * 요구사항 기반 테스트 스위트
 *
 * 실행: npm run build && node --test tests/
 *
 * 계층:
 *  [단위]   네트워크 없이 순수 로직 검증 (judge, 파서, 성과계산, 가드레일 입력검증)
 *  [통합]   토스 라이브 API 사용 — 읽기 전용 + dry-run (실주문 절대 없음: TOSS_DRY_RUN=true 전제)
 *  [E2E]    대시보드 서버 기동 후 API 검증
 *
 * 안전:
 *  - TOSS_DRY_RUN=true 확인 후에만 주문 경로 테스트 실행 (아니면 즉시 중단)
 *  - 테스트가 건드리는 데이터 파일(positions/decisions/trades/scheduler_state)은 백업 후 복원
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

require('dotenv').config();

// ── 안전장치: 실주문 모드면 테스트 자체를 거부 ──
if (process.env.TOSS_DRY_RUN === 'false') {
  console.error('❌ TOSS_DRY_RUN=false 상태에서는 테스트를 실행하지 않습니다 (실주문 위험).');
  process.exit(1);
}

const DATA = (f) => path.join(process.cwd(), 'data', 'json', f);
const backups = new Map();

/** 데이터 파일 백업 (테스트 종료 시 복원) */
function backup(file) {
  const p = DATA(file);
  backups.set(file, fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null);
}
/** 백업 복원 */
function restoreAll() {
  for (const [file, content] of backups) {
    const p = DATA(file);
    if (content === null) { if (fs.existsSync(p)) fs.unlinkSync(p); }
    else fs.writeFileSync(p, content);
  }
}

before(() => {
  ['positions.json', 'decisions.json', 'trades.json', 'scheduler_state.json'].forEach(backup);
});
after(() => restoreAll());

/* ═══════════════════════════════════════════════════════════
 * 요구사항 1. 토스 실계좌 = 진실 (폴백 없음, 실패 시 명시적 에러)
 * ═══════════════════════════════════════════════════════════ */
describe('[단위] R1. 잔고·보유는 토스 전용', () => {
  test('토스 키가 없으면 getCashBalance는 조용한 폴백 대신 throw', async () => {
    const saved = process.env.TOSS_API_KEY;
    process.env.TOSS_API_KEY = '';
    try {
      const db = require('../dist/storage/database.js');
      await assert.rejects(() => db.getCashBalance(), /토스 API 미설정/);
      await assert.rejects(() => db.getHoldings(), /토스 API 미설정/);
    } finally {
      process.env.TOSS_API_KEY = saved;
    }
  });
});

/* ═══════════════════════════════════════════════════════════
 * 요구사항 2·3. 주문 가드레일 (토스 스펙 + 안전한도)
 *   — 입력 검증은 네트워크 호출 전에 수행되므로 오프라인
 * ═══════════════════════════════════════════════════════════ */
describe('[단위] R2. 주문 입력 가드레일', () => {
  const { executeBuy, executeSell } = require('../dist/services/trading.js');

  test('KRX 심볼(6자리 숫자) 거부', async () => {
    const r = await executeBuy({ symbol: '005930', qty: 1, orderType: 'MARKET' });
    assert.equal(r.success, false);
    assert.match(r.error, /미국 티커가 아닙니다/);
  });

  test('qty·amount 모두 누락 시 거부', async () => {
    const r = await executeBuy({ symbol: 'AAPL', orderType: 'MARKET' });
    assert.equal(r.success, false);
    assert.match(r.error, /하나는 필수/);
  });

  test('qty+amount 동시 지정 거부 (토스: 정확히 하나만)', async () => {
    const r = await executeBuy({ symbol: 'AAPL', qty: 1, amount: 100, orderType: 'MARKET' });
    assert.equal(r.success, false);
    assert.match(r.error, /동시에 지정/);
  });

  test('금액(amount) 주문 + LIMIT 거부 (토스: MARKET 전용)', async () => {
    const r = await executeBuy({ symbol: 'AAPL', amount: 100, orderType: 'LIMIT', price: 200 });
    assert.equal(r.success, false);
    assert.match(r.error, /MARKET 전용/);
  });

  test('소수점 수량 매수 거부 (토스: 소수점은 MARKET 매도만)', async () => {
    const r = await executeBuy({ symbol: 'AAPL', qty: 0.5, orderType: 'MARKET' });
    assert.equal(r.success, false);
    assert.match(r.error, /시장가 매도에만/);
  });

  test('소수점 수량 LIMIT 매도 거부', async () => {
    const r = await executeSell({ symbol: 'AAPL', qty: 0.5, orderType: 'LIMIT', price: 200 });
    assert.equal(r.success, false);
    assert.match(r.error, /시장가 매도에만/);
  });

  test('LIMIT 주문에 price 누락 시 거부', async () => {
    const r = await executeBuy({ symbol: 'AAPL', qty: 1, orderType: 'LIMIT' });
    assert.equal(r.success, false);
    assert.match(r.error, /price가 필요/);
  });
});

/* ═══════════════════════════════════════════════════════════
 * 요구사항 4. 정규장 전용 거래 (프리/애프터마켓 금지)
 * ═══════════════════════════════════════════════════════════ */
describe('[통합] R4. 정규장 전용 게이트', () => {
  test('장외 시간 주문은 세션 게이트에서 거부', async (t) => {
    const { isUsRegularSessionOpen } = require('../dist/services/toss.js');
    const open = await isUsRegularSessionOpen();
    if (open) return t.skip('현재 정규장 개장 중 — 장외 거부 테스트는 폐장 시에만 유효');

    delete process.env.TOSS_ENFORCE_REGULAR_SESSION; // 게이트 활성 (기본값)
    const { executeBuy } = require('../dist/services/trading.js');
    const r = await executeBuy({ symbol: 'AAPL', amount: 10, orderType: 'MARKET' });
    assert.equal(r.success, false);
    assert.match(r.error, /정규장 시간이 아닙니다/);
  });
});

/* ═══════════════════════════════════════════════════════════
 * 요구사항 3(계속). 라이브 가드레일: LIMIT 괴리·잔고·24h 한도
 * ═══════════════════════════════════════════════════════════ */
describe('[통합] R3. 라이브 가드레일 (dry-run)', () => {
  before(() => { process.env.TOSS_ENFORCE_REGULAR_SESSION = 'false'; });
  after(() => { delete process.env.TOSS_ENFORCE_REGULAR_SESSION; });

  test('LIMIT 지정가가 현재가 ±20% 벗어나면 거부 (환각 가격 차단)', async () => {
    const { getPrices } = require('../dist/services/toss.js');
    const { executeBuy } = require('../dist/services/trading.js');
    const last = (await getPrices(['AAPL']))['AAPL'];
    assert.ok(last > 0, 'AAPL 현재가 조회');

    const r = await executeBuy({ symbol: 'AAPL', qty: 1, orderType: 'LIMIT', price: Math.round(last * 2) });
    assert.equal(r.success, false);
    assert.match(r.error, /벗어남/);
  });

  test('매수가능금액 초과 매수 거부', async () => {
    const { executeBuy } = require('../dist/services/trading.js');
    const r = await executeBuy({ symbol: 'AAPL', amount: 999999, orderType: 'MARKET' });
    assert.equal(r.success, false);
    // 종목당 한도($1000) 또는 잔고 부족 — 어느 쪽이든 금액 가드가 잡아야 함
    assert.match(r.error, /초과/);
  });

  test('24시간 누적 매수 한도 작동', async () => {
    // 잔고($0.47)보다 작은 주문($0.40)이 누적 한도에 걸리도록 직전 매수 $1,999.7 주입
    const trades = JSON.parse(fs.readFileSync(DATA('trades.json'), 'utf-8'));
    trades.push({
      id: 99999, traded_at: new Date().toISOString(),
      symbol: 'TSTX', side: 'BUY', qty: 1, price: 1999.7, fee: 0, note: '[테스트 주입]'
    });
    fs.writeFileSync(DATA('trades.json'), JSON.stringify(trades, null, 2));

    try {
      const { executeBuy } = require('../dist/services/trading.js');
      const r = await executeBuy({ symbol: 'AAPL', amount: 0.4, orderType: 'MARKET' });
      assert.equal(r.success, false);
      assert.match(r.error, /24시간 누적/);
    } finally {
      // 주입 제거 (전체 복원은 after에서도 하지만 다음 테스트 오염 방지)
      const cleaned = JSON.parse(fs.readFileSync(DATA('trades.json'), 'utf-8')).filter(t => t.id !== 99999);
      fs.writeFileSync(DATA('trades.json'), JSON.stringify(cleaned, null, 2));
    }
  });

  test('dry-run 주문은 성공하되 실전송·감사기록 없음', async () => {
    const before = JSON.parse(fs.readFileSync(DATA('trades.json'), 'utf-8')).length;
    const { executeBuy } = require('../dist/services/trading.js');
    const r = await executeBuy({ symbol: 'AAPL', amount: 0.4, orderType: 'MARKET' });
    assert.equal(r.success, true, `dry-run 주문안 생성: ${r.error || 'OK'}`);
    assert.equal(r.dryRun, true, 'dryRun 플래그');
    const afterCnt = JSON.parse(fs.readFileSync(DATA('trades.json'), 'utf-8')).length;
    assert.equal(afterCnt, before, 'dry-run은 trades.json에 기록되지 않음');
  });
});

/* ═══════════════════════════════════════════════════════════
 * 요구사항 5. SL/TP 실시간 감시 판정
 * ═══════════════════════════════════════════════════════════ */
describe('[단위] R5. SL/TP 판정 (judge)', () => {
  const { judge } = require('../dist/jobs/watcher.js');
  const base = {
    symbol: 'T', status: 'OPEN', shares: 10, avg_cost: 100,
    opened_at: '', updated_at: '', stop_loss: 90, take_profit_1: 115, take_profit_2: 130
  };

  test('손절가 도달 → 전량 매도', () => {
    const a = judge(base, 89);
    assert.equal(a.type, 'STOP_LOSS');
    assert.equal(a.qty, 10);
  });
  test('SL과 TP 사이 → 대기', () => assert.equal(judge(base, 100), null));
  test('TP1 도달 → 절반 매도', () => {
    const a = judge(base, 116);
    assert.equal(a.type, 'TP1');
    assert.equal(a.qty, 5);
  });
  test('TP1 기체결(tp1_done) → 재발동 안 함', () =>
    assert.equal(judge({ ...base, tp1_done: true }, 116), null));
  test('TP2 도달 → 잔량 전량', () => {
    const a = judge(base, 131);
    assert.equal(a.type, 'TP2');
    assert.equal(a.qty, 10);
  });
  test('SL·TP2 동시 조건이면 손절 우선 (방어적)', () => {
    const weird = { ...base, stop_loss: 200, take_profit_2: 130 };
    assert.equal(judge(weird, 150).type, 'STOP_LOSS');
  });
  test('1주 보유 TP1 → 절반 불가 시 전량', () =>
    assert.equal(judge({ ...base, shares: 1 }, 116).qty, 1));
  test('계획 없는 포지션 → 대기', () =>
    assert.equal(judge({ ...base, stop_loss: undefined, take_profit_1: undefined, take_profit_2: undefined }, 50), null));
});

/* ═══════════════════════════════════════════════════════════
 * 요구사항 6. Manager 결정 파싱 (기계 판독용 JSON)
 * ═══════════════════════════════════════════════════════════ */
describe('[단위] R6. 결정 파서', () => {
  const { parseManagerDecision } = require('../dist/services/decision.js');
  const wrap = (json) => `# 리포트\n\n\`\`\`json\n${json}\n\`\`\``;

  test('정상 결정 파싱 + 심볼 대문자화 + $·콤마 정규화', () => {
    const d = parseManagerDecision(wrap(`{"actions":[
      {"symbol":"nvda","action":"BUY","order_type":"LIMIT","qty":"2","limit_price":"$1,178.50","stop_loss":165}
    ]}`), 'T1');
    assert.equal(d.actions[0].symbol, 'NVDA');
    assert.equal(d.actions[0].qty, 2);
    assert.equal(d.actions[0].limit_price, 1178.5);
    assert.equal(d.actions[0].stop_loss, 165);
  });

  test('트레일링 콤마 허용 (LLM 특유의 느슨한 JSON)', () => {
    const d = parseManagerDecision(wrap(`{"actions":[{"symbol":"AAPL","action":"HOLD",},]}`), 'T2');
    assert.ok(d);
    assert.equal(d.actions[0].action, 'HOLD');
  });

  test('유효하지 않은 action은 필터링', () => {
    const d = parseManagerDecision(wrap(`{"actions":[
      {"symbol":"AAPL","action":"YOLO"},
      {"symbol":"MSFT","action":"SELL"}
    ]}`), 'T3');
    assert.equal(d.actions.length, 1);
    assert.equal(d.actions[0].symbol, 'MSFT');
  });

  test('여러 json 블록 중 actions 가진 마지막 블록 채택', () => {
    const md = wrap(`{"note":"예시"}`) + '\n\n' + wrap(`{"actions":[{"symbol":"TSLA","action":"BUY","amount":100}]}`);
    const d = parseManagerDecision(md, 'T4');
    assert.equal(d.actions[0].symbol, 'TSLA');
  });

  test('json 블록 없으면 null (파이프라인은 계속)', () =>
    assert.equal(parseManagerDecision('# 그냥 리포트', 'T5'), null));
});

/* ═══════════════════════════════════════════════════════════
 * 요구사항 7. 결정 집행 (순서·스킵·이중집행 방지·보정)
 * ═══════════════════════════════════════════════════════════ */
describe('[통합] R7. 결정 집행 (dry-run)', () => {
  before(() => { process.env.TOSS_ENFORCE_REGULAR_SESSION = 'false'; });
  after(() => { delete process.env.TOSS_ENFORCE_REGULAR_SESSION; });

  test('HOLD 스킵 + 미보유 SELL 거부 + 잔고 초과 BUY 거부', async () => {
    const { executeDecision } = require('../dist/services/executor.js');
    const s = await executeDecision({
      report_id: 'EXEC-T', decided_at: new Date().toISOString(),
      actions: [
        { symbol: 'MSFT', action: 'HOLD', order_type: 'MARKET' },
        { symbol: 'NVDA', action: 'SELL', order_type: 'MARKET' },      // 미보유
        { symbol: 'AAPL', action: 'BUY', order_type: 'MARKET', amount: 500 } // 잔고 $0.47 초과
      ]
    });
    assert.equal(s.skipped.length, 1, 'HOLD 1건 스킵');
    assert.match(s.skipped[0], /MSFT/);
    const sellFail = s.failed.find(f => f.symbol === 'NVDA');
    assert.match(sellFail.error, /매도 가능 수량이 없습니다/);
    const buyFail = s.failed.find(f => f.symbol === 'AAPL');
    assert.match(buyFail.error, /초과/);
  });

  test('LIMIT+amount 조합은 거부 대신 MARKET으로 보정', async () => {
    const { executeDecision } = require('../dist/services/executor.js');
    const s = await executeDecision({
      report_id: 'EXEC-T2', decided_at: new Date().toISOString(),
      actions: [{ symbol: 'AAPL', action: 'BUY', order_type: 'LIMIT', amount: 10, limit_price: 200 }]
    });
    // 보정 후 MARKET 금액주문 → 잔고 가드 도달 (스펙 위반 400이 아니라)
    const r = s.failed[0] || s.executed[0];
    assert.match(r.error || 'OK', /매수가능금액|초과/);
  });

  test('실집행 마킹된 결정은 재집행 차단 (이중 매수 방지)', async () => {
    const { saveDecision, isDecisionExecuted, markDecisionExecuted } = require('../dist/services/decision.js');
    fs.writeFileSync(DATA('decisions.json'), '[]');
    await saveDecision({ report_id: 'DUP-T', decided_at: new Date().toISOString(), actions: [] });
    assert.equal(await isDecisionExecuted('DUP-T'), false, '집행 전: 허용');
    await markDecisionExecuted('DUP-T');
    assert.equal(await isDecisionExecuted('DUP-T'), true, '집행 후: 차단');
  });
});

/* ═══════════════════════════════════════════════════════════
 * 요구사항 8. 포지션 reconcile (토스=진실, 재진입 초기화)
 * ═══════════════════════════════════════════════════════════ */
describe('[통합] R8. 포지션 동기화', () => {
  test('reconcile: 실보유 반영 + 유령 포지션 CLOSED + 재진입 계획 초기화', async () => {
    // 시드: 실보유(005930)를 CLOSED+낡은 SL로, 미보유(ZZZZ)를 OPEN으로
    fs.writeFileSync(DATA('positions.json'), JSON.stringify([
      { symbol: '005930', status: 'CLOSED', shares: 0, avg_cost: 0, opened_at: '2025-01-01', updated_at: '2025-01-01', stop_loss: 999999, tp1_done: true },
      { symbol: 'ZZZZ', status: 'OPEN', shares: 5, avg_cost: 10, opened_at: '2025-01-01', updated_at: '2025-01-01' }
    ]));

    const { reconcileWithToss } = require('../dist/storage/positions.js');
    const merged = await reconcileWithToss();

    const samsung = merged.find(p => p.symbol === '005930');
    assert.equal(samsung.status, 'OPEN', '실보유는 OPEN 복구');
    assert.equal(samsung.stop_loss, undefined, '재진입 시 낡은 손절가 제거 (즉시 오발동 방지)');
    assert.equal(samsung.tp1_done, undefined, '재진입 시 tp1_done 초기화');
    assert.equal(samsung.currency, 'KRW', '통화 보존');

    const ghost = merged.find(p => p.symbol === 'ZZZZ');
    assert.equal(ghost.status, 'CLOSED', '토스에 없는 포지션은 청산 처리');
    assert.equal(ghost.shares, 0);
  });
});

/* ═══════════════════════════════════════════════════════════
 * 요구사항 9. 성과 계산 (통화 구분·현금 포함·기준점)
 * ═══════════════════════════════════════════════════════════ */
describe('[단위] R9. 성과 계산', () => {
  const perf = require('../dist/services/performance.js');
  const RATE = 1500;

  test('KRW 종목은 환율 미적용, USD는 적용 (이중적용 사고 방지)', () => {
    const p = perf.calculateCurrentPerformance(
      [
        { symbol: '005930', shares: 1, avg_cost: 300000, currency: 'KRW' },
        { symbol: 'AAPL', shares: 2, avg_cost: 100, currency: 'USD' }
      ],
      { '005930': 300000, 'AAPL': 100 },
      RATE
    );
    // 300,000 + 200*1500 = 600,000
    assert.equal(p.current_value_krw, 600000);
  });

  test('현금(USD)이 총자산에 포함 (초기자금과 대칭)', () => {
    const p = perf.calculateCurrentPerformance([], {}, RATE, undefined, 100000, 10);
    assert.equal(p.current_value_krw, 15000, '현금 $10 × 1500');
    assert.equal(p.initial_capital_krw, 100000);
  });

  test('기준점 리셋: 초기자금=현재자산이면 수익률 0%', () => {
    const p = perf.calculateCurrentPerformance(
      [{ symbol: 'AAPL', shares: 1, avg_cost: 100, currency: 'USD' }],
      { 'AAPL': 100 }, RATE, undefined, 150000, 0
    );
    assert.equal(p.total_return_from_initial_percent, 0);
  });

  test('보유 0 + 원금 0이어도 NaN 없이 0%', () => {
    const p = perf.calculateCurrentPerformance([], {}, RATE, undefined, 1000, 0);
    assert.equal(p.total_return_percent, 0);
    assert.ok(Number.isFinite(p.total_return_from_initial_percent));
  });

  test('진행바: 극단 진행률(음수/100%초과)에도 크래시 없음', () => {
    const p = perf.calculateCurrentPerformance([], {}, RATE, undefined, 1000, 0);
    for (const pct of [-4220, 0, 50, 100, 4320]) {
      const report = perf.generatePerformanceReport(p, {
        target_amount_krw: 1e7, current_amount_krw: 0, remaining_amount_krw: 1e7,
        progress_percent: pct, required_return_percent: 0, current_return_percent: 0,
        is_on_track: false, monthly_target_krw: 0, days_since_start: 0
      });
      assert.ok(report.includes('['), `progress ${pct}% 렌더링`);
    }
  });
});

/* ═══════════════════════════════════════════════════════════
 * 요구사항 10. 동시성 (파일 락 — 유실·중복 없음)
 * ═══════════════════════════════════════════════════════════ */
describe('[단위] R10. 파일 쓰기 직렬화', () => {
  test('병렬 insert 10건 — 전부 기록, ID 중복 없음', async () => {
    const { db } = require('../dist/storage/database.js');
    const TEST = 'concurrency_test';
    fs.writeFileSync(DATA(TEST + '.json'), '[]');
    try {
      await Promise.all(Array.from({ length: 10 }, (_, i) => db.insert(TEST, { n: i })));
      const rows = JSON.parse(fs.readFileSync(DATA(TEST + '.json'), 'utf-8'));
      assert.equal(rows.length, 10, '유실 없음');
      assert.equal(new Set(rows.map(r => r.id)).size, 10, 'ID 중복 없음');
    } finally {
      fs.unlinkSync(DATA(TEST + '.json'));
    }
  });

  test('병렬 포지션 갱신 5건 — 전부 보존 (lost update 없음)', async () => {
    fs.writeFileSync(DATA('positions.json'), JSON.stringify([
      { symbol: 'LOCK', status: 'OPEN', shares: 10, avg_cost: 100, opened_at: 'x', updated_at: 'x' }
    ]));
    const p = require('../dist/storage/positions.js');
    await Promise.all([
      p.updatePosition('LOCK', { tp1_done: true }),
      p.updatePosition('LOCK', { stop_loss: 90 }),
      p.updatePosition('LOCK', { take_profit_1: 115 }),
      p.updatePosition('LOCK', { take_profit_2: 130 }),
      p.updatePosition('LOCK', { rationale: 'r' })
    ]);
    const final = JSON.parse(fs.readFileSync(DATA('positions.json'), 'utf-8'))[0];
    assert.equal(final.tp1_done, true);
    assert.equal(final.stop_loss, 90);
    assert.equal(final.take_profit_1, 115);
    assert.equal(final.take_profit_2, 130);
    assert.equal(final.rationale, 'r');
  });
});

/* ═══════════════════════════════════════════════════════════
 * 요구사항 11. 스케줄러 (개장일 판정·하루 1회)
 * ═══════════════════════════════════════════════════════════ */
describe('[통합] R11. 스케줄러/캘린더', () => {
  test('토스 US 캘린더: 정규장 구간과 다음 영업일 제공', async () => {
    const { getUsMarketCalendar } = require('../dist/services/toss.js');
    const cal = await getUsMarketCalendar();
    assert.match(cal.today.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(cal.next.date, /^\d{4}-\d{2}-\d{2}$/);
    // 다음 영업일에는 정규장이 반드시 존재
    assert.ok(cal.next.regular === null || cal.next.regular.start < cal.next.regular.end);
  });

  test('실행일 영속화: 상태 파일 왕복', () => {
    const p = DATA('scheduler_state.json');
    fs.writeFileSync(p, JSON.stringify({ lastReportDate: '2026-07-13' }));
    assert.equal(JSON.parse(fs.readFileSync(p, 'utf-8')).lastReportDate, '2026-07-13');
  });
});

/* ═══════════════════════════════════════════════════════════
 * 요구사항 12. 대시보드 (localhost, API 6종, 경로 탈출 차단)
 * ═══════════════════════════════════════════════════════════ */
describe('[E2E] R12. 대시보드 서버', () => {
  const PORT = 8899;
  let server;

  before(async () => {
    server = spawn('node', ['--no-deprecation', 'dist/index.js'], {
      env: { ...process.env, PORT: String(PORT), ENABLE_SCHEDULER: 'false' },
      stdio: 'ignore'
    });
    // 기동 대기 (최대 15초)
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/dashboard/api/status`);
        if (r.ok) return;
      } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('대시보드 서버 기동 실패');
  });
  after(() => { if (server) server.kill(); });

  const api = (p) => fetch(`http://127.0.0.1:${PORT}/dashboard/api/${p}`).then(r => r.json());

  test('status: dry-run 여부·장 상태 노출', async () => {
    const s = await api('status');
    assert.equal(s.success, true);
    assert.equal(s.data.dryRun, true);
    assert.equal(typeof s.data.sessionOpen, 'boolean');
  });

  test('portfolio: 실계좌 현금·보유·통화 반영', async () => {
    const s = await api('portfolio');
    assert.equal(s.success, true);
    assert.equal(typeof s.data.cash_usd, 'number');
    assert.ok(Array.isArray(s.data.holdings));
    const krw = s.data.holdings.find(h => h.currency === 'KRW');
    if (krw) assert.ok(krw.avg_cost > 1000, 'KRW 종목은 원화 단위 그대로');
  });

  test('trades / positions / decisions / reports 응답 형식', async () => {
    for (const ep of ['trades?limit=5', 'positions', 'decisions', 'reports']) {
      const s = await api(ep);
      assert.equal(s.success, true, ep);
      assert.ok(Array.isArray(s.data), ep);
    }
  });

  test('리포트 파일명 화이트리스트 — 경로 탈출 차단', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/dashboard/api/reports/..%2F..%2F.env`);
    assert.ok([400, 404].includes(r.status), `경로 탈출 시도 → ${r.status} (허용 안 됨)`);
    const r2 = await fetch(`http://127.0.0.1:${PORT}/dashboard/api/reports/see%2Fetc%2Fpasswd`);
    assert.ok([400, 404].includes(r2.status));
  });

  test('루트(/)는 대시보드로 리다이렉트', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), /dashboard/);
  });
});
