import dotenv from 'dotenv';
import { isNasdaqOpen } from '../utils/marketday';
import { generateManagerReport, saveManagerReport } from '../services/manager';
import { sendReportEmail, wrapInEmailTemplate } from '../services/mail';

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
 * - 매주 월요일 한국시간 16:00에 GitHub Actions로 자동 실행
 * - Agent_GPT, Agent_Gemini, Agent_Claude의 15:00 리포트를 종합
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

    // 5. Manager_Agent 이메일 발송 (16:00)
    console.log('📧 Manager_Agent 최종 리포트 이메일 발송 중...');
    await sendManagerEmail(managerReport, reportPath);

    console.log('🎉 Manager_Agent 통합 리포트 파이프라인 완료');

  } catch (error) {
    console.error('❌ Manager_Agent 파이프라인 실패:', error);
    
    // 실패 시 오류 이메일 발송
    await sendErrorEmail(error as Error);
    
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
    const geminiReports = files.filter(file =>
      file.includes('weekly_agent_gemini.md')
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

    if (geminiReports.length === 0) {
      const errorMsg = `❌ 필수 Agent 리포트를 찾을 수 없습니다: *_weekly_agent_gemini.md`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    if (claudeReports.length === 0) {
      const errorMsg = `❌ 필수 Agent 리포트를 찾을 수 없습니다: *_weekly_agent_claude.md`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    // 각 Agent의 최신 리포트 확인
    const latestGptReport = gptReports.sort().reverse()[0];
    const latestGeminiReport = geminiReports.sort().reverse()[0];
    const latestClaudeReport = claudeReports.sort().reverse()[0];

    console.log(`✅ Agent 리포트 확인:`);
    console.log(`  - GPT: ${latestGptReport}`);
    console.log(`  - Gemini: ${latestGeminiReport}`);
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
 * Manager_Agent 이메일 발송
 */
async function sendManagerEmail(report: string, reportPath: string): Promise<void> {
  try {
    const currentDate = new Date().toLocaleDateString('ko-KR');
    
    const emailHtml = wrapInEmailTemplate(
      report.replace(/\n/g, '<br>'), 
      `Manager_Agent 최종 통합 리포트 (${currentDate})`
    );
    
    await sendReportEmail({
      subject: `🏢 Manager_Agent 최종 통합 리포트 - ${currentDate}`,
      html: emailHtml,
      mdPath: reportPath
    });
    
    console.log('✅ Manager_Agent 이메일 전송 완료');
    
  } catch (error) {
    console.error('❌ Manager_Agent 이메일 전송 실패:', error);
    throw error;
  }
}

/**
 * 오류 발생 시 알림 이메일 발송
 */
async function sendErrorEmail(error: Error): Promise<void> {
  try {
    const currentDate = new Date().toLocaleDateString('ko-KR');
    const currentTime = new Date().toLocaleTimeString('ko-KR');
    
    const errorReport = `
# 🚨 Manager_Agent 실행 오류 알림

## 오류 정보
- **발생 시간**: ${currentDate} ${currentTime}
- **오류 메시지**: ${error.message}
- **상세 내용**: ${error.stack || '스택 트레이스 없음'}

## 가능한 원인
1. Agent 리포트들이 15:00에 생성되지 않음
2. 데이터베이스 연결 문제
3. API 호출 한도 초과
4. 파일 시스템 오류

## 대응 방안
1. 15:00 Agent 리포트 생성 상태 확인
2. GitHub Actions 로그 확인
3. 수동으로 Agent 리포트 재실행
4. Manager_Agent 수동 실행

---
*자동 오류 알림 시스템*
    `;
    
    const emailHtml = wrapInEmailTemplate(
      errorReport.replace(/\n/g, '<br>'), 
      `Manager_Agent 오류 알림 (${currentDate})`
    );
    
    await sendReportEmail({
      subject: `🚨 Manager_Agent 오류 알림 - ${currentDate}`,
      html: emailHtml
    });
    
    console.log('📧 오류 알림 이메일 전송 완료');
    
  } catch (emailError) {
    console.error('❌ 오류 알림 이메일 전송도 실패:', emailError);
  }
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