import { db } from '../storage/database';

/**
 * Manager 구조화 결정(Decision) 서비스
 *
 * Manager 리포트는 사람용 마크다운과 함께 기계 판독용 ```json 블록을 출력한다.
 * 이 파일은 그 블록을 파싱·검증·저장한다. (정규식 텍스트 추출을 대체)
 *
 * - 결정 = "이번 사이클에 무엇을 하라"는 지시(불변 기록, decisions.json)
 * - 포지션(positions.ts) = "지금 무엇을 어떤 계획으로 들고 있나"는 상태
 */

/** 매매 방향: 매수 / 매도 / 보류 */
export type DecisionAction = 'BUY' | 'SELL' | 'HOLD';

/** 종목별 결정 항목 */
export interface DecisionItem {
  symbol: string;
  action: DecisionAction;
  order_type: 'LIMIT' | 'MARKET';
  qty?: number;              // 수량 기반 주문
  amount?: number;           // 금액 기반(소수점 매수, USD)
  limit_price?: number;      // order_type === 'LIMIT'일 때
  stop_loss?: number;        // 손절가
  take_profit_1?: number;    // 1차 익절가 (예: 50% 매도)
  take_profit_2?: number;    // 2차 익절가 (전량 매도)
  time_horizon?: string;     // 보유 예정 기간
  rationale?: string;        // 결정 근거
}

/** Manager 한 사이클의 전체 결정 */
export interface ManagerDecision {
  report_id: string;
  decided_at: string;
  actions: DecisionItem[];
  executed_at?: string;   // 실주문 집행 완료 시각 (dry-run은 기록 안 함 — 재집행 허용)
}

const DECISIONS_FILE = 'decisions';

/** 숫자 또는 숫자문자열을 number로, 그 외는 undefined */
function toNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''));
  return isFinite(n) ? n : undefined;
}

/**
 * 리포트 마크다운에서 기계 판독용 ```json 블록을 파싱
 *
 * - 여러 코드펜스가 있으면 `actions` 배열을 가진 마지막 블록을 채택
 * - 각 항목을 검증·정규화(숫자 변환, 기본 order_type=MARKET)
 * @param reportMarkdown Manager 리포트 전문
 * @param reportId 리포트 식별자
 * @returns 파싱된 결정 (없거나 무효면 null)
 */
export function parseManagerDecision(reportMarkdown: string, reportId: string): ManagerDecision | null {
  // ```json ... ``` 블록 전부 추출
  const fenceRegex = /```json\s*([\s\S]*?)```/gi;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(reportMarkdown)) !== null) {
    blocks.push(m[1].trim());
  }
  if (blocks.length === 0) {
    console.warn('⚠️ Manager 리포트에서 기계 판독용 json 블록을 찾지 못했습니다.');
    return null;
  }

  // actions 배열을 가진 마지막 블록 채택
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      // LLM 출력 특유의 느슨한 JSON 허용: 트레일링 콤마 제거
      // (파싱 실패 = 그날 결정 전체 유실이므로 흔한 실수는 관대하게 수용)
      const lenient = blocks[i].replace(/,\s*([}\]])/g, '$1');
      const parsed = JSON.parse(lenient);
      const rawActions = Array.isArray(parsed) ? parsed : parsed.actions;
      if (!Array.isArray(rawActions)) continue;

      const actions: DecisionItem[] = rawActions
        .filter((a: any) => a && typeof a.symbol === 'string' && ['BUY', 'SELL', 'HOLD'].includes(a.action))
        .map((a: any) => ({
          symbol: a.symbol.toUpperCase(),
          action: a.action as DecisionAction,
          order_type: a.order_type === 'LIMIT' ? 'LIMIT' : 'MARKET',
          qty: toNum(a.qty),
          amount: toNum(a.amount),
          limit_price: toNum(a.limit_price),
          stop_loss: toNum(a.stop_loss),
          take_profit_1: toNum(a.take_profit_1),
          take_profit_2: toNum(a.take_profit_2),
          time_horizon: a.time_horizon ? String(a.time_horizon) : undefined,
          rationale: a.rationale ? String(a.rationale) : undefined
        }));

      if (actions.length === 0) continue;
      return { report_id: reportId, decided_at: new Date().toISOString(), actions };
    } catch (error) {
      // 다음 블록 시도
    }
  }

  console.warn('⚠️ json 블록을 찾았으나 유효한 actions를 파싱하지 못했습니다.');
  return null;
}

/**
 * 결정을 decisions.json에 추가 저장 (불변 기록)
 * @param decision 파싱된 Manager 결정
 */
export async function saveDecision(decision: ManagerDecision): Promise<void> {
  await db.withLock(DECISIONS_FILE, async () => {
    const all = await db.read<ManagerDecision>(DECISIONS_FILE);
    all.push(decision);
    await db.write(DECISIONS_FILE, all);
  });
  console.log(`💾 결정 저장 완료: ${decision.actions.length}개 액션 (report ${decision.report_id})`);
}

/**
 * 해당 report_id의 결정이 이미 실주문 집행됐는지 확인
 * - 파이프라인 재실행(수동 npm run report 등) 시 같은 결정의 이중 매수를 막는다
 * @param reportId 확인할 report_id
 * @returns 실집행 이력이 있으면 true
 */
export async function isDecisionExecuted(reportId: string): Promise<boolean> {
  const all = await db.read<ManagerDecision>(DECISIONS_FILE);
  return all.some(d => d.report_id === reportId && d.executed_at);
}

/**
 * 결정의 실집행 완료를 기록 (report_id 기준 최신 항목에 마킹)
 * @param reportId 집행된 결정의 report_id
 */
export async function markDecisionExecuted(reportId: string): Promise<void> {
  await db.withLock(DECISIONS_FILE, async () => {
    const all = await db.read<ManagerDecision>(DECISIONS_FILE);
    // 같은 report_id가 여러 개면 가장 최근 것에 마킹
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].report_id === reportId) {
        all[i].executed_at = new Date().toISOString();
        break;
      }
    }
    await db.write(DECISIONS_FILE, all);
  });
}

/**
 * 최근 결정 조회
 * @param limit 최대 개수
 */
export async function getRecentDecisions(limit: number = 10): Promise<ManagerDecision[]> {
  const all = await db.read<ManagerDecision>(DECISIONS_FILE);
  return all
    .sort((a, b) => new Date(b.decided_at).getTime() - new Date(a.decided_at).getTime())
    .slice(0, limit);
}
