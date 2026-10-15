/**
 * Claude 호출의 단일 관문 — Claude Code CLI(구독 계정) 또는 Anthropic API.
 *
 * 왜 필요한가: 2026-10-15 사용자 결정으로 Claude 리포트(Agent_Claude·Manager·주간회고)를
 * API 과금 대신 이 Mac에 로그인된 Claude Code 계정 사용량으로 돌린다.
 * `claude -p`(헤드리스)를 자식 프로세스로 띄우고 stream-json 출력을 파싱한다.
 *
 * 백엔드 선택 (.env):
 *  - CLAUDE_BACKEND=claude_code → CLI 우선 (미설정이면 api — 기존 동작)
 *  - CLAUDE_CODE_FALLBACK_API=false → CLI 실패 시 API로 넘어가지 않는다 (기본은 넘어감).
 *    구독 사용량 한도에 걸리면 CLI가 실패하는데, 그날 Manager 결정이 통째로 사라지는 것보다
 *    API 1회 과금이 낫다고 보고 기본값을 '넘어감'으로 둔다.
 *  - CLAUDE_CLI_PATH → claude 실행 파일 경로 (launchd PATH에 ~/.local/bin이 없을 수 있다)
 *
 * CLI 격리: 빈 작업 폴더 + 도구 없음 + 설정·MCP 미로딩 + 세션 미저장.
 * 이 저장소의 CLAUDE.md·훅·메모리가 Manager 입력에 섞이지 않게 한다.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { LlmUsageEntry } from './llmUsage';

/** Claude 호출 요청 */
export interface ClaudeCallOptions {
  role: LlmUsageEntry['role'];  // 사용량 기록용 역할
  model: string;                 // 모델 ID
  system?: string;               // 시스템 프롬프트 (없으면 생략)
  prompt: string;                // 사용자 메시지
  effort: string;                // 사고 깊이 (low~max)
  maxTokens: number;             // 사고+본문 합산 상한
  timeoutMs?: number;            // CLI 최대 실행 시간 (기본 15분)
  noRecord?: boolean;            // 사용량 기록 생략 (사전 점검 프로브용)
}

/** 정규화된 응답 — 두 백엔드가 같은 모양을 돌려준다 */
export interface ClaudeCallResult {
  text: string;                  // 최종 본문
  thinking: string;              // 사고 요약 (없으면 '')
  stopReason: string | null;     // end_turn / max_tokens / refusal …
  stopDetails?: { category?: string; explanation?: string };
  via: 'claude_code' | 'api';    // 실제로 처리한 백엔드
}

/** CLI 백엔드를 쓰도록 설정됐는가 */
export function claudeCodeEnabled(): boolean {
  return (process.env.CLAUDE_BACKEND || 'api').trim().toLowerCase() === 'claude_code';
}

/** CLI 실패 시 API로 넘어갈지 (기본 true) */
function fallbackToApi(): boolean {
  return (process.env.CLAUDE_CODE_FALLBACK_API || 'true').trim().toLowerCase() !== 'false';
}

/** claude 실행 파일 경로 — 설정값 → ~/.local/bin/claude → PATH의 claude 순 */
function cliPath(): string {
  if (process.env.CLAUDE_CLI_PATH) return process.env.CLAUDE_CLI_PATH;
  const local = path.join(os.homedir(), '.local', 'bin', 'claude');
  return existsSync(local) ? local : 'claude';
}

/**
 * Claude를 호출한다. CLI 설정이면 CLI 먼저, 실패하면(허용 시) API.
 * 거부(refusal)는 백엔드 문제가 아니라 내용 판정이므로 API로 다시 보내지 않는다.
 * @returns 정규화된 응답
 */
export async function callClaude(opts: ClaudeCallOptions): Promise<ClaudeCallResult> {
  if (claudeCodeEnabled()) {
    try {
      return await callViaClaudeCode(opts);
    } catch (e) {
      const msg = (e as Error).message;
      if (!fallbackToApi() || /refusal|거부/.test(msg)) throw e;
      console.error(`⚠️ Claude Code 호출 실패 → API로 대체 (${opts.role}): ${msg.slice(0, 200)}`);
    }
  }
  return callViaApi(opts);
}

/**
 * Claude Code CLI(`claude -p`)로 호출한다 — 로그인된 구독 계정 사용량을 쓴다.
 * ANTHROPIC_API_KEY를 자식 환경에서 지워 API 과금으로 새지 않게 한다.
 */
async function callViaClaudeCode(opts: ClaudeCallOptions): Promise<ClaudeCallResult> {
  const cwd = path.join(os.tmpdir(), 'nasdaq-autotrader-claude');
  mkdirSync(cwd, { recursive: true });

  const args = [
    '-p', '--model', opts.model, '--effort', opts.effort,
    '--tools', '', '--setting-sources', '', '--strict-mcp-config',
    '--no-session-persistence', '--output-format', 'stream-json', '--verbose',
  ];
  if (opts.system) args.push('--system-prompt', opts.system);

  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(opts.maxTokens) };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const started = Date.now();
  const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn(cliPath(), args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Claude Code 시간 초과 (${Math.round((opts.timeoutMs ?? 900000) / 1000)}초)`)); }, opts.timeoutMs ?? 900000);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(new Error(`Claude Code 실행 실패: ${e.message}`)); });
    child.on('close', c => { clearTimeout(timer); resolve({ stdout: out, stderr: err, code: c }); });
    child.stdin.end(opts.prompt);
  });

  // stream-json: 줄마다 JSON 1개. assistant 메시지의 thinking 블록과 마지막 result 이벤트를 쓴다.
  let result: any = null;
  const thinking: string[] = [];
  let apiKeySource: string | undefined;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'system' && ev.subtype === 'init') apiKeySource = ev.apiKeySource;
    if (ev.type === 'assistant') {
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'thinking' && typeof c.thinking === 'string' && c.thinking.trim()) thinking.push(c.thinking.trim());
      }
    }
    if (ev.type === 'result') result = ev;
  }

  if (!result) {
    throw new Error(`Claude Code 결과 없음 (exit ${code}): ${(stderr || stdout).trim().slice(-300)}`);
  }
  if (result.is_error || result.subtype !== 'success') {
    throw new Error(`Claude Code 오류 (${result.subtype}, status ${result.api_error_status ?? '-'}): ${String(result.result ?? '').slice(0, 300)}`);
  }
  // 구독 계정이 아니라 API 키로 인증됐다면 사용자가 원한 과금 경로가 아니다 — 기록에 남긴다
  if (apiKeySource && apiKeySource !== 'none') {
    console.warn(`⚠️ Claude Code가 API 키(${apiKeySource})로 인증됨 — 구독 사용량이 아니다`);
  }

  if (!opts.noRecord) await (await import('./llmUsage')).recordAnthropicUsage(opts.role, opts.model, result.usage, 'claude_code');
  console.log(`🖥️ Claude Code 응답 (${opts.role}, ${opts.model}, ${Math.round((Date.now() - started) / 1000)}초, stop=${result.stop_reason})`);

  return {
    text: String(result.result ?? ''),
    thinking: thinking.join('\n\n'),
    stopReason: result.stop_reason ?? null,
    via: 'claude_code',
  };
}

/**
 * Anthropic API로 호출한다 (기존 경로). ~16K 초과 출력은 HTTP 타임아웃 위험이 있어 스트리밍으로 받는다.
 * output_config는 설치된 SDK 타입에 없어 교집합 타입으로 넓힌다 (필드는 와이어에 그대로 실린다).
 */
async function callViaApi(opts: ClaudeCallOptions): Promise<ClaudeCallResult> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY 환경변수가 설정되지 않았습니다');
  const client = new Anthropic({ apiKey });
  const stream = client.messages.stream({
    model: opts.model,
    max_tokens: opts.maxTokens,
    output_config: { effort: opts.effort },
    thinking: { type: 'adaptive', display: 'summarized' },
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: 'user', content: opts.prompt }],
  } as Anthropic.MessageCreateParamsNonStreaming & {
    output_config: { effort: string };
    thinking: { type: string; display: string };
  });
  // 거부 사유(stop_details)는 message_delta에 실려 오는데 finalMessage()가 옮기지 않는다 (2026-10-08)
  let streamStopDetails: { category?: string; explanation?: string } | undefined;
  stream.on('streamEvent', (ev: any) => {
    const details = ev?.type === 'message_delta' ? ev.delta?.stop_details : undefined;
    if (details) streamStopDetails = details;
  });
  const resp = await stream.finalMessage();
  await (await import('./llmUsage')).recordAnthropicUsage(opts.role, opts.model, resp.usage, 'api');

  const textBlock = resp.content.find(c => c.type === 'text');
  const thinking = resp.content
    .filter((c: any) => c.type === 'thinking' && typeof c.thinking === 'string' && c.thinking.trim())
    .map((c: any) => c.thinking.trim())
    .join('\n\n');
  return {
    text: textBlock && textBlock.type === 'text' ? textBlock.text : '',
    thinking,
    stopReason: resp.stop_reason ?? null,
    stopDetails: (resp as any).stop_details ?? streamStopDetails,
    via: 'api',
  };
}

/**
 * 호출 가능 여부만 확인하는 최소 프로브 (Manager 사전 점검용).
 * CLI 설정이면 CLI로 1회 호출, 실패하면(허용 시) API 프로브 결과를 따른다.
 * @returns 가능하면 null, 불가능하면 사유
 */
export async function probeClaude(model: string): Promise<string | null> {
  if (claudeCodeEnabled()) {
    try {
      await callViaClaudeCode({ role: 'manager', model, prompt: 'ok라고만 답하라.', effort: 'low', maxTokens: 1000, timeoutMs: 120000, noRecord: true });
      return null;
    } catch (e) {
      const msg = (e as Error).message;
      if (!fallbackToApi()) return `Claude Code 호출 불가: ${msg.slice(0, 160)}`;
      console.warn(`⚠️ Claude Code 사전 점검 실패 → API 대체 가능 여부 확인: ${msg.slice(0, 160)}`);
    }
  }
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return 'CLAUDE_API_KEY 미설정';
  await new Anthropic({ apiKey }).messages.create({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] });
  return null;
}
