/**
 * LLM 사용량 기록 — 호출마다 토큰 수를 남겨 비용과 소진 속도를 보이게 한다.
 *
 * 왜 필요한가: 비용 때문에 Manager 모델을 두 번 바꿨고(2026-09-03, 09-27),
 * 2026-09-22에는 OpenAI 크레딧이 예고 없이 바닥나 6일간 매매가 멈췄다.
 * 그런데 토큰 사용량은 어디에도 기록되지 않아 "얼마나 쓰고 있는지"를 알 수 없었다.
 *
 * 비용(USD)은 .env의 LLM_PRICE_<모델>=입력단가,출력단가 (100만 토큰당 USD)가 있을 때만
 * 계산한다. 가격을 코드에 박지 않는 이유: 모델·가격이 자주 바뀌고, 틀린 가격으로 계산한
 * 비용은 없는 것보다 해롭다 (그럴듯한 숫자가 판단을 오도한다).
 */


/** 사용량 기록 1건 */
export interface LlmUsageEntry {
  at: string;                 // 호출 완료 시각 (ISO)
  role: 'agent_gpt' | 'agent_claude' | 'manager' | 'weekly_review';
  model: string;
  input: number;              // 입력(프롬프트) 토큰
  output: number;             // 출력 토큰 (추론 토큰 포함 — 과금 기준)
  reasoning?: number;         // 출력 중 추론 토큰 (OpenAI가 알려줄 때만)
}

/**
 * OpenAI chat.completions 응답의 usage를 기록한다.
 * @param role 호출 역할 / @param model 모델 ID / @param usage 응답의 usage 필드
 */
export async function recordOpenAIUsage(role: LlmUsageEntry['role'], model: string, usage: any): Promise<void> {
  if (!usage) return;
  await append({
    at: new Date().toISOString(), role, model,
    input: usage.prompt_tokens ?? 0,
    output: usage.completion_tokens ?? 0,
    reasoning: usage.completion_tokens_details?.reasoning_tokens ?? undefined,
  });
}

/**
 * Anthropic messages 응답의 usage를 기록한다.
 * 캐시 읽기/쓰기 토큰도 입력으로 합산한다 (과금 대상이므로 사용량에서 빠지면 안 된다).
 */
export async function recordAnthropicUsage(role: LlmUsageEntry['role'], model: string, usage: any): Promise<void> {
  if (!usage) return;
  await append({
    at: new Date().toISOString(), role, model,
    input: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    output: usage.output_tokens ?? 0,
  });
}

/** 기록 실패가 리포트 생성을 막지 않도록 모든 오류를 삼킨다 */
async function append(entry: LlmUsageEntry): Promise<void> {
  try {
    const { db } = await import('../storage/database');
    await db.insert('llm_usage', entry as LlmUsageEntry & { id?: number });
  } catch (e) {
    console.warn('⚠️ LLM 사용량 기록 실패(무시):', (e as Error).message);
  }
}

/**
 * .env 가격표에서 모델 단가를 찾는다. 키는 모델 ID의 영숫자 외 문자를 _로 바꾼 대문자.
 * 예) gpt-6-sol → LLM_PRICE_GPT_6_SOL=1.25,10
 * @returns [입력, 출력] 100만 토큰당 USD (설정 없으면 null)
 */
function priceOf(model: string): [number, number] | null {
  const raw = process.env['LLM_PRICE_' + model.toUpperCase().replace(/[^A-Z0-9]/g, '_')];
  if (!raw) return null;
  const [i, o] = raw.split(',').map(Number);
  return Number.isFinite(i) && Number.isFinite(o) ? [i, o] : null;
}

/**
 * 대시보드용 사용량 요약: 최근 N일의 일별·역할별 토큰과(가격 설정 시) 비용.
 * @param days 집계 기간 (기본 14일)
 */
export async function summarizeUsage(days = 14): Promise<Record<string, unknown>> {
  let list: LlmUsageEntry[] = [];
  try { list = await (await import('../storage/database')).db.read<LlmUsageEntry>('llm_usage'); } catch { /* 기록 없음 */ }
  const since = Date.now() - days * 86400000;
  const recent = list.filter(e => new Date(e.at).getTime() >= since);
  const kstDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const costOf = (e: LlmUsageEntry) => {
    const p = priceOf(e.model);
    return p ? (e.input * p[0] + e.output * p[1]) / 1e6 : null;
  };

  const byDay = new Map<string, { input: number; output: number; cost: number; priced: boolean; calls: number }>();
  const byRole = new Map<string, { model: string; input: number; output: number; calls: number; cost: number; priced: boolean }>();
  for (const e of recent) {
    const c = costOf(e);
    const d = byDay.get(kstDay(e.at)) || { input: 0, output: 0, cost: 0, priced: true, calls: 0 };
    d.input += e.input; d.output += e.output; d.calls++;
    if (c === null) d.priced = false; else d.cost += c;
    byDay.set(kstDay(e.at), d);
    const r = byRole.get(e.role) || { model: e.model, input: 0, output: 0, calls: 0, cost: 0, priced: true };
    r.model = e.model; r.input += e.input; r.output += e.output; r.calls++;
    if (c === null) r.priced = false; else r.cost += c;
    byRole.set(e.role, r);
  }
  const unpricedModels = [...new Set(recent.filter(e => !priceOf(e.model)).map(e => e.model))];
  return {
    days,
    firstRecordAt: list.length ? list[0].at : null,
    totalCalls: recent.length,
    byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    byRole: [...byRole.entries()].map(([role, v]) => ({ role, ...v })),
    unpricedModels,
  };
}
