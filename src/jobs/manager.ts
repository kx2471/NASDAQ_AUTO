import dotenv from 'dotenv';
import { isNasdaqOpen } from '../utils/marketday';
import { generateManagerReport, saveManagerReport } from '../services/manager';
import { parseManagerDecision, saveDecision, isDecisionExecuted, markDecisionExecuted } from '../services/decision';
import { reconcileWithToss, applyDecisionToPositions } from '../storage/positions';

// 환경변수 로드
dotenv.config();

/**
 * 한국 시간 기준 날짜 문자열 생성 (YYYYMMDD 형식)
 */
function getKoreanDateString(): string {
  const now = new Date();
  const koreanTime = new Date(now.getTime() + (9 * 60 * 60 * 1000)); // UTC + 9시간
  return koreanTime.toISOString().split('T')[0].replace(/-/g, '');
}

/**
 * Manager_Agent 통합 리포트 생성 파이프라인
 * - 나스닥 개장일마다 로컬 스케줄러(scheduler.ts)가 에이전트 리포트 직후 실행
 * - Agent_GPT, Agent_Claude의 15:00 리포트를 종합
 * - GPT-5 기반 Manager_Agent가 최종 통합 의사결정 생성
 * - 구체적이고 실행 가능한 매매 지시사항 제공
 */
export async function runManager(): Promise<void> {
  const today = new Date();
  
  console.log(`🏢 Manager_Agent 통합 리포트 파이프라인 시작: ${today.toISOString()}`);

  try {
    // 1. 미국 시장 휴장일 확인
    if (!isNasdaqOpen(today)) {
      console.log('📅 미국 시장 휴장일입니다. Manager_Agent 실행을 건너뜁니다.');
      return;
    }

    // 2. Agent 리포트들이 생성되었는지 확인 (15:00 실행 완료 여부)
    await validateAgentReportsExist();

    // 3. Manager_Agent 통합 리포트 생성
    console.log('🏢 Manager_Agent 통합 분석 시작...');
    const managerReport = await generateManagerReport();

    // 4. Manager_Agent 리포트 저장
    console.log('💾 Manager_Agent 최종 리포트 저장 중...');
    const reportPath = await saveManagerReport(managerReport);

    // 5. 이메일 발송 없음 — 리포트는 data/report에 저장되어 대시보드에서 열람
    //    (사용자 요청으로 모든 이메일 발송 제거, 2026-07-13)
    void reportPath;

    // 6. 기계 판독용 결정 파싱 + 포지션 동기화 (자동매매 입력)
    //  - 토스 보유종목(진실)과 positions.json(의도)을 먼저 동기화
    //  - Manager 결정의 SL/TP/보유계획/근거를 보유 포지션에 반영
    try {
      const reportId = getKoreanDateString();
      await reconcileWithToss();
      const decision = parseManagerDecision(managerReport, reportId);
      if (decision) {
        await saveDecision(decision);
        await applyDecisionToPositions(decision);
        const counts = decision.actions.reduce((acc: Record<string, number>, a) => {
          acc[a.action] = (acc[a.action] || 0) + 1; return acc;
        }, {});
        console.log(`✅ 결정 파싱 완료: BUY ${counts.BUY || 0} / SELL ${counts.SELL || 0} / HOLD ${counts.HOLD || 0}`);

        // 7. 결정 집행 (Phase 3): 정규장 개장을 기다렸다가 매도→매수 순으로 주문
        //  - AUTO_EXECUTE_DECISION=false로 끌 수 있음 (기본 켜짐)
        //  - TOSS_DRY_RUN=true면 주문안 로깅까지만 (실전송 없음)
        if (process.env.AUTO_EXECUTE_DECISION !== 'false') {
          // 이중 집행 방지: 같은 report_id로 이미 실주문이 나갔으면 재집행 금지
          // (수동 npm run report 재실행, 파이프라인 재시도 등)
          if (await isDecisionExecuted(reportId)) {
            console.warn(`⚠️ report ${reportId} 결정은 이미 실집행됨 — 이중 매매 방지를 위해 집행을 건너뜁니다.`);
          } else {
            const { waitForRegularSession, executeDecision } = await import('../services/executor');
            const sessionOpen = await waitForRegularSession(90);
            if (sessionOpen) {
              const summary = await executeDecision(decision);
              // 실주문 체결이 있었으면 집행 마킹 + 포지션 재동기화 (dry-run은 마킹 안 함 — 테스트 반복 허용)
              if (summary.executed.some(r => !r.dryRun)) {
                await markDecisionExecuted(reportId);
                await reconcileWithToss();
                await applyDecisionToPositions(decision); // 신규 매수 종목에 SL/TP 계획 반영
              }
            } else {
              console.warn('⚠️ 정규장이 90분 내에 열리지 않아 결정 집행을 건너뜁니다 (휴장일 가능성).');
            }
          }
        } else {
          console.log('ℹ️ AUTO_EXECUTE_DECISION=false — 결정 기록만 하고 집행하지 않습니다.');
        }
      } else {
        console.warn('⚠️ 구조화 결정을 파싱하지 못해 포지션 계획 갱신을 건너뜁니다 (리포트 JSON 블록 확인 필요).');
      }
    } catch (decisionError) {
      console.error('⚠️ 결정 파싱/포지션 동기화/집행 실패 (리포트는 정상 저장됨):', decisionError);
      // 결정 처리 실패해도 파이프라인은 계속 진행
    }

    console.log('🎉 Manager_Agent 통합 리포트 파이프라인 완료');

  } catch (error) {
    console.error('❌ Manager_Agent 파이프라인 실패:', error);
    // 오류는 로그와 대시보드로 확인 (이메일 발송 제거됨)
    throw error;
  }
}

/**
 * Agent 리포트들이 존재하는지 확인
 */
async function validateAgentReportsExist(): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');

  const agentReportsDir = path.join(process.cwd(), 'data', 'report');

  try {
    const files = await fs.readdir(agentReportsDir);

    // 모든 weekly agent 리포트 찾기 (날짜와 상관없이)
    const gptReports = files.filter(file =>
      file.includes('weekly_agent_gpt.md')
    );
    const claudeReports = files.filter(file =>
      file.includes('weekly_agent_claude.md')
    );

    if (gptReports.length === 0) {
      const errorMsg = `❌ 필수 Agent 리포트를 찾을 수 없습니다: *_weekly_agent_gpt.md`;
      console.error(errorMsg);
      console.error('💡 Agent 리포트들이 먼저 생성되어야 합니다.');
      throw new Error(errorMsg);
    }

    if (claudeReports.length === 0) {
      const errorMsg = `❌ 필수 Agent 리포트를 찾을 수 없습니다: *_weekly_agent_claude.md`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    // 각 Agent의 최신 리포트 확인
    const latestGptReport = gptReports.sort().reverse()[0];
    const latestClaudeReport = claudeReports.sort().reverse()[0];

    console.log(`✅ Agent 리포트 확인:`);
    console.log(`  - GPT: ${latestGptReport}`);
    console.log(`  - Claude: ${latestClaudeReport}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('필수 Agent 리포트')) {
      throw error;
    }
    console.error('❌ 리포트 디렉토리 확인 실패:', error);
    throw new Error('Agent 리포트 디렉토리에 접근할 수 없습니다.');
  }

  console.log('✅ 모든 Agent 리포트 확인 완료');
}

/**
 * 개발/테스트용 Manager_Agent 실행
 */
export async function runManagerDev(): Promise<void> {
  console.log('🧪 개발용 Manager_Agent 실행...');
  
  try {
    // 개발 환경에서는 유효성 검사 건너뛰기
    console.log('⚠️ 개발 모드: Agent 리포트 유효성 검사 건너뛰기');
    
    const managerReport = await generateManagerReport();
    const reportPath = await saveManagerReport(managerReport);
    
    console.log('📋 Manager_Agent 리포트 생성 완료:');
    console.log('='.repeat(50));
    console.log(managerReport);
    console.log('='.repeat(50));
    console.log(`💾 저장 경로: ${reportPath}`);
    
  } catch (error) {
    console.error('❌ 개발용 Manager_Agent 실행 실패:', error);
    throw error;
  }
}