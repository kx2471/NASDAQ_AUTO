/**
 * 조건부 진입 · 만료 트레일링 순수 함수 단위 테스트 (네트워크·주문 없음)
 *
 * 실행: npm run build && node --test tests/entryTrigger.test.js
 * requirements.test.js는 실주문 모드에서 실행을 거부하므로, 순수 로직만 별도 파일로 둔다.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const { previousCloseBefore, resolveTrigger, shouldFireEntry } = require('../dist/services/entryTrigger');
const { judgeExpiryPassed, effectiveStopLoss } = require('../dist/jobs/watcher');

// 미국 정규장 09:30 ET = 13:30Z (서머타임)
const at = (d) => `${d}T13:30:00.000Z`;
const session = (d) => new Date(at(d)).getTime();

describe('전일 종가 (previousCloseBefore)', () => {
  test('진행 중인 오늘 봉은 제외하고 직전 거래일 종가를 고른다', () => {
    const candles = [
      { date: at('2026-10-21'), close: 100 },
      { date: at('2026-10-22'), close: 105 },
      { date: at('2026-10-23'), close: 111 } // 오늘(진행 중)
    ];
    assert.equal(previousCloseBefore(candles, session('2026-10-23')), 105);
  });
  test('KST 타임스탬프(+09:00)도 미국 날짜로 판정한다', () => {
    const candles = [
      { date: '2026-10-22T22:30:00.000+09:00', close: 50 }, // = 10/22 09:30 ET
      { date: '2026-10-23T22:30:00.000+09:00', close: 55 }  // = 10/23 09:30 ET (오늘)
    ];
    assert.equal(previousCloseBefore(candles, session('2026-10-23')), 50);
  });
  test('봉이 없으면 undefined', () => {
    assert.equal(previousCloseBefore([], session('2026-10-23')), undefined);
  });
});

describe('진입 기준가·판정', () => {
  test('기본은 전일 종가', () => {
    assert.deepEqual(resolveTrigger({ symbol: 'A', action: 'BUY', order_type: 'MARKET' }, 100), { price: 100, basis: 'prev_close' });
  });
  test('전일 종가보다 낮은 지정가는 그 값을 쓴다', () => {
    assert.deepEqual(resolveTrigger({ symbol: 'A', action: 'BUY', order_type: 'LIMIT', limit_price: 97 }, 100), { price: 97, basis: 'limit_price' });
  });
  test('전일 종가보다 높은 지정가는 무시한다 (추격 매수 우회 차단)', () => {
    assert.deepEqual(resolveTrigger({ symbol: 'A', action: 'BUY', order_type: 'LIMIT', limit_price: 104 }, 100), { price: 100, basis: 'prev_close' });
  });
  test('현재가 ≤ 기준가일 때만 발동', () => {
    assert.equal(shouldFireEntry(100, 100), true);
    assert.equal(shouldFireEntry(99.9, 100), true);
    assert.equal(shouldFireEntry(100.01, 100), false);
    assert.equal(shouldFireEntry(0, 100), false);
  });
});

describe('만료 통과 판정 (judgeExpiryPassed)', () => {
  // 10/09(금) 진입 → 10/12~10/23 10거래일, 만료일 10/23 (ISRG 실제 일정)
  const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16',
    '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];
  const mk = (closes) => [{ date: at('2026-10-09'), close: 400 }, ...days.map((d, i) => ({ date: at(d), close: closes[i] }))];
  const opened = '2026-10-09T13:30:06.572Z';

  test('만료일 종가 ≥ 평단+2%면 통과, 진입 후 종가 고점을 돌려준다', () => {
    const r = judgeExpiryPassed(mk([410, 420, 430, 440, 445, 420, 410, 406, 430, 435]), opened, session('2026-10-26'), 416.62);
    assert.deepEqual(r, { expiryClose: 435, peakClose: 445 });
  });
  test('만료일 종가가 +2% 미만이면 null (정리는 Manager 몫)', () => {
    assert.equal(judgeExpiryPassed(mk([410, 420, 430, 440, 445, 420, 410, 406, 420, 424]), opened, session('2026-10-26'), 416.62), null);
  });
  test('만료일 당일 세션 중에는 아직 판정하지 않는다 (종가 미확정)', () => {
    assert.equal(judgeExpiryPassed(mk([410, 420, 430, 440, 445, 420, 410, 406, 430, 435]), opened, session('2026-10-23'), 416.62), null);
  });
});

describe('보호선 (effectiveStopLoss) — 만료 트레일링', () => {
  test('만료 트레일링은 max(고점 −5%, 평단 +2%)', () => {
    const p = { symbol: 'X', avg_cost: 100, stop_loss: 92, expiry_trail: true, peak_price: 110, take_profit_1: 108 };
    assert.equal(effectiveStopLoss(p), 104.5);
  });
  test('TP1 미도달 만료 트레일링은 TP1을 고점으로 쓰지 않는다 (즉시 매도 방지)', () => {
    const p = { symbol: 'X', avg_cost: 100, stop_loss: 92, expiry_trail: true, peak_price: 103, take_profit_1: 120 };
    assert.equal(effectiveStopLoss(p), 102); // 103×0.95=97.85 < 평단+2%=102
  });
  test('TP1 이후 기존 동작 유지 — 고점 기록이 없으면 TP1을 고점 추정치로', () => {
    const p = { symbol: 'X', avg_cost: 416.62, stop_loss: 383.29, tp1_done: true, take_profit_1: 449.95 };
    assert.equal(effectiveStopLoss(p), 427.45);
  });
  test('보호 대상이 아니면 저장된 SL 그대로', () => {
    assert.equal(effectiveStopLoss({ symbol: 'X', avg_cost: 100, stop_loss: 92 }), 92);
  });
});

describe('진입 품질 (entryQuality)', () => {
  const { buildEpisodes, measureEpisode } = require('../dist/services/entryQuality');
  test('보유 0→매수→부분매도→전량매도를 한 진입으로 묶고 결과를 계산한다', () => {
    const eps = buildEpisodes([
      { traded_at: '2026-10-09T13:30:00Z', symbol: 'A', side: 'BUY', qty: 2, price: 100 },
      { traded_at: '2026-10-12T15:00:00Z', symbol: 'A', side: 'SELL', qty: 1, price: 108 },
      { traded_at: '2026-10-14T15:00:00Z', symbol: 'A', side: 'SELL', qty: 1, price: 102 },
      { traded_at: '2026-10-15T13:30:00Z', symbol: 'A', side: 'BUY', qty: 1, price: 90 }
    ]);
    assert.equal(eps.length, 2);
    assert.equal(eps[0].exitAt, '2026-10-14T15:00:00Z');
    assert.equal(Math.round(eps[0].realizedPct * 10) / 10, 5);
    assert.equal(eps[1].exitAt, undefined);
  });
  test('추격폭·초기3일·보유 MAE/MFE', () => {
    const c = (d, h, l, cl) => ({ date: `${d}T13:30:00.000Z`, high: h, low: l, close: cl });
    const m = measureEpisode(
      { symbol: 'A', entryAt: '2026-10-12T13:31:00Z', entryPrice: 105, exitAt: '2026-10-16T15:00:00Z' },
      [c('2026-10-09', 101, 98, 100), c('2026-10-12', 106, 103, 104), c('2026-10-13', 104, 99, 100),
       c('2026-10-14', 101, 97, 98), c('2026-10-15', 112, 99, 110), c('2026-10-16', 111, 100, 101), c('2026-10-19', 130, 120, 125)]
    );
    assert.equal(m.chasePct, 5);      // 105 vs 전일 종가 100
    assert.equal(m.mae3Pct, -7.6);    // 3일 저가 97
    assert.equal(m.mfe3Pct, 1);       // 3일 고가 106
    assert.equal(m.mfePct, 6.7);      // 보유 고가 112 (청산 후 130은 제외)
  });
});
