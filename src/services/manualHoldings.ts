/**
 * 사용자 수동 보유 종목 — 자동매매가 건드리지 않는 종목 목록
 *
 * 계기: 2026-11-07 사용자가 SOXL을 직접 매수하고 "건들지 마"라고 지시했다.
 * 토스 보유는 전부 자동매매 포지션으로 간주돼 Manager가 규칙12(42% 초과 축소)로 매도하거나
 * 슬롯 3종을 채운 것으로 볼 수 있었다.
 *
 * 목록은 코드가 아니라 .env `MANUAL_SYMBOLS`(쉼표 구분)에서 읽는다 — 심볼 하드코딩 금지.
 * 적용 지점: 주문 최후 관문(trading.executeOrder), 포지션 동기화, Manager·에이전트 입력, 재배치 현금비율.
 */
import type { Holding } from '../storage/database';

/**
 * 수동 보유 심볼 집합
 * @returns 대문자 심볼 Set (설정 없으면 빈 Set)
 */
export function manualSymbols(): Set<string> {
  return new Set(
    (process.env.MANUAL_SYMBOLS || '')
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)
  );
}

/**
 * 수동 보유 종목인지
 * @param symbol 심볼
 */
export function isManualSymbol(symbol: string): boolean {
  return manualSymbols().has(symbol.toUpperCase());
}

/**
 * 토스 보유를 자동매매 관리분과 사용자 수동분으로 나눈다
 * @param holdings 토스 실보유
 * @returns managed(자동매매 대상), manual(사용자 보유 — 판단·주문 대상 아님)
 */
export function splitHoldings<T extends Pick<Holding, 'symbol'>>(holdings: T[]): { managed: T[]; manual: T[] } {
  const set = manualSymbols();
  return {
    managed: holdings.filter(h => !set.has(h.symbol.toUpperCase())),
    manual: holdings.filter(h => set.has(h.symbol.toUpperCase())),
  };
}

/** AI 입력에 붙이는 안내문 — 수동 보유가 없으면 undefined */
export function manualHoldingsNote(manual: Array<Pick<Holding, 'symbol'>>): string | undefined {
  if (manual.length === 0) return undefined;
  return `${manual.map(h => h.symbol).join(', ')}은(는) 사용자가 직접 보유한 종목이다. 자동매매 대상이 아니므로 ` +
    `holdings·슬롯 수·비중·총자산 계산에서 이미 제외했다. 매수·매도·HOLD 어떤 결정도 내리지 말고 언급하지도 마라.`;
}
