/**
 * weeklyReview.ts — 주간 메타 리뷰 (전략 회고).
 *
 * 일일 Manager 결정이 "전술"이라면, 이건 주 1회(일요일, 미장 휴장일) 도는 "전략" 층위다.
 * 지난 한 주의 실현 원장·자산 궤적·저널·결정 결과 전체를 놓고 패턴을 진단하고,
 * 다음 주 전략 조정을 제안하는 회고 리포트를 쓴다.
 *
 * - 매매 결정 아님: JSON 파싱·집행 없음. 순수 회고 문서 (data/report에 저장, 대시보드 열람)
 * - 리뷰의 [JOURNAL] 한 줄은 저널에 누적돼 다음 일일 결정에도 주입된다 (전략→전술 환류)
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import path from 'path';
import {
  buildRealizedLedger, buildPerformanceTrajectory, buildDecisionOutcomes,
  readJournal, appendJournalFromReport, readPlaybook, replacePlaybookFromReview,
} from './managerRecords';

const REVIEW_SYSTEM_PROMPT = `당신은 자동매매 시스템의 수석 전략가입니다. 지난 한 주의 매매 기록 전체를 보고 "주간 전략 회고"를 작성하세요.

이 문서는 매매 지시가 아닙니다 — 패턴 진단과 전략 조정, 그리고 **매매 규칙서 재작성**입니다. 일일 결정 Manager가 다음 주에 이 규칙서를 최우선으로 따릅니다.

## 출력 구조 (마크다운, 2,500토큰 이내)
# 📆 주간 전략 회고
## 1. 한 주 성과 요약 (3-4줄)
## 2. 잘한 결정 vs 잘못한 결정 (각 1-3개, 구체적 종목·숫자 인용)
## 3. 패턴 진단
- 청산 사유 분포(손절발동 비율이 높으면 SL 설정 문제), 승률·평균 손익폭·보유일의 함의
- 반복되는 실수 또는 확인된 강점
## 4. 저널 교훈 검증
- 기존 저널 교훈 중 이번 주 데이터로 확인/반박된 것
## 5. 🎯 매매 규칙서 재작성 (핵심 산출물)
아래 입력의 "현재 규칙서"를 이번 주 데이터로 **재작성**하라. 단순 추가가 아니라 증류·교체다:
- 데이터로 **확인된 규칙은 유지·강화**, **반박된 규칙은 삭제**, **새 패턴은 규칙으로 승격**
- 각 규칙에 반드시 **근거를 한 구절**로 달 것 (실현원장 통계·청산사유 분포·저널 관찰 등)
- **총 15개 이내.** 넘으면 신호가 약한 규칙부터 버려라
- 규칙은 **'판단 성향'에 관한 것만**: 진입 기준(RSI·모멘텀), 손절폭, 익절 배분, 보유기간, 집중도 등.
  주문 한도·dry-run·시스템 설정은 **규칙서 밖**이다(코드 가드레일이 관리 — 규칙에 넣지 마라).

## 맨 끝 출력 (필수 · 순서 준수)
먼저 재작성된 규칙서 전문을 아래 마커로 감싸고, 그 다음 줄에 저널 한 줄을 남겨라.
[PLAYBOOK]
1. <규칙> — 근거: <통계/관찰>
2. <규칙> — 근거: <통계/관찰>
...
[/PLAYBOOK]
[JOURNAL] <이번 주 회고에서 나온 가장 중요한 전략 교훈 한 문장>`;

/** 리뷰 실행 중 여부 (중복 실행 방지) */
let reviewRunning = false;

/**
 * 주간 전략 회고 실행: 기록 수집 → Fable 5 회고 생성 → 리포트 저장 + 저널 누적
 * @returns 저장된 리포트 경로 (실패 시 null — 파이프라인에 영향 없음)
 */
export async function runWeeklyReview(): Promise<string | null> {
  if (reviewRunning) { console.warn('⚠️ 주간 리뷰 이미 실행 중 — 스킵'); return null; }
  reviewRunning = true;
  try {
    const apiKey = (process.env.CLAUDE_API_KEY || '').trim();
    if (!apiKey) { console.warn('⚠️ CLAUDE_API_KEY 없음 — 주간 리뷰 스킵'); return null; }
    const model = process.env.MANAGER_MODEL || 'claude-opus-4-8';

    console.log('📆 주간 전략 회고 시작...');
    const [ledger, trajectory, outcomes, journal, playbook] = await Promise.all([
      buildRealizedLedger().catch(() => '조회 실패'),
      buildPerformanceTrajectory().catch(() => '조회 실패'),
      buildDecisionOutcomes().catch(() => '조회 실패'),
      readJournal(50).catch(() => '조회 실패'),
      readPlaybook().catch(() => '조회 실패'),
    ]);

    const userContext = [
      '## 📒 실현 손익 원장 (전체 통계 + 최근 청산)', ledger,
      '\n## 📈 자산 궤적 + 목표 페이스', trajectory,
      '\n## ⚡ 최근 결정 → 실제 결과', outcomes,
      '\n## 🧠 누적 의사결정 저널 (검증 대상)', journal,
      '\n## 🎯 현재 매매 규칙서 (이걸 재작성하라 — 없으면 새로 세워라)', playbook,
    ].join('\n');

    // Fable 5: thinking 항상 ON, 사고 요약은 회고에도 부록으로 남긴다.
    // effort는 high — 회고는 xhigh까지 필요 없는 종합 작업 (주 1회라 비용 부담도 작음).
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model,
      max_tokens: 12000,
      output_config: { effort: 'high' },
      thinking: { type: 'adaptive', display: 'summarized' },
      system: REVIEW_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContext }],
    } as Anthropic.MessageCreateParamsNonStreaming & {
      output_config: { effort: string };
      thinking: { type: string; display: string };
    });

    const textBlock = resp.content.find(c => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('빈 응답');
    let content = textBlock.text;

    // 사고 요약 부록 (감사 추적 — 일일 리포트와 동일한 패턴)
    const thinkingSummary = resp.content
      .filter((c: any) => c.type === 'thinking' && typeof c.thinking === 'string' && c.thinking.trim())
      .map((c: any) => c.thinking.trim().replace(/```/g, "'''"))
      .join('\n\n');
    if (thinkingSummary) {
      content += `\n\n---\n\n## 🧩 회고 사고 과정 (요약)\n\n<details><summary>펼치기</summary>\n\n${thinkingSummary}\n\n</details>\n`;
    }

    // 저장: data/report/YYYYMMDD_HHMM_weekly_review.md (대시보드 리포트 목록 패턴 준수)
    const now = new Date();
    const kstDate = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).replace(/-/g, '');
    const kstTime = now.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit', minute: '2-digit' }).replace(':', '');
    const filename = `${kstDate}_${kstTime}_weekly_review.md`;
    const filePath = path.join(process.cwd(), 'data/report', filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');

    // 전략 교훈을 저널에 누적 (일일 결정에도 환류)
    const lesson = await appendJournalFromReport(`WR-${kstDate}`, content);
    if (lesson) console.log(`🧠 주간 전략 교훈 저널 기록: ${lesson.slice(0, 80)}`);

    // 🎯 매매 규칙서 재작성 — 이것이 '프롬프트 자기수정'의 실체 (조언 계층만 갱신, 백업·상한 내장)
    const newPlaybook = await replacePlaybookFromReview(`WR-${kstDate}`, content).catch(() => null);
    if (newPlaybook) console.log(`🎯 매매 규칙서 재작성됨 (${newPlaybook.length}자, 이전 버전 백업)`);
    else console.log('ℹ️ 규칙서 블록 없음 — 기존 규칙서 유지');

    console.log(`✅ 주간 전략 회고 저장: ${filename}`);
    return filePath;
  } catch (e) {
    console.error('❌ 주간 리뷰 실패 (다음 주 재시도):', (e as Error).message);
    return null;
  } finally {
    reviewRunning = false;
  }
}
