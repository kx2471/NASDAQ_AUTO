import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import fs from 'fs/promises';
import path from 'path';

/**
 * 이메일 발송 옵션 인터페이스
 */
export interface EmailOptions {
  to?: string;
  subject: string;
  html: string;
  mdPath?: string;
  attachments?: Array<{
    filename: string;
    path: string;
  }>;
}

/**
 * 리포트 이메일 발송
 * 설정된 제공자(Resend 또는 SMTP)를 사용
 */
export async function sendReportEmail(options: EmailOptions): Promise<void> {
  const provider = process.env.MAIL_PROVIDER || 'RESEND';

  // 전역 이메일 차단: MAIL_PROVIDER=DISABLED면 어떤 경로에서도 발송하지 않음
  // (리포트는 data/report 저장 + 대시보드 열람으로 대체)
  if (provider.toUpperCase() === 'DISABLED') {
    console.log(`📧 이메일 발송 생략 (MAIL_PROVIDER=DISABLED): ${options.subject}`);
    return;
  }

  const { subject, html, mdPath, attachments = [] } = options;
  const to = options.to || process.env.MAIL_TO;

  if (!to) {
    throw new Error('이메일 수신자가 설정되지 않았습니다 (MAIL_TO)');
  }

  console.log(`📧 ${provider}를 사용하여 이메일 발송 시작: ${to}`);

  // 첨부파일에 마크다운 파일 추가
  if (mdPath && await fileExists(mdPath)) {
    attachments.push({
      filename: path.basename(mdPath),
      path: mdPath
    });
  }

  try {
    switch (provider.toUpperCase()) {
      case 'RESEND':
        await sendWithResend({ to, subject, html, attachments });
        break;
      
      case 'SMTP':
        await sendWithSMTP({ to, subject, html, attachments });
        break;
      
      default:
        throw new Error(`알 수 없는 메일 제공자: ${provider}`);
    }

    console.log('✅ 이메일 발송 성공');

  } catch (error) {
    console.error('❌ 이메일 발송 실패:', error);
    throw error;
  }
}

/**
 * 지연 함수 (재시도용)
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Resend를 사용한 이메일 발송 (재시도 로직 포함)
 */
async function sendWithResend(options: {
  to: string;
  subject: string;
  html: string;
  attachments: Array<{ filename: string; path: string }>;
}, maxRetries: number = 3): Promise<void> {
  const { to, subject, html, attachments } = options;

  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY가 설정되지 않았습니다');
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.MAIL_FROM || 'Claude Stock Bot <claude@resend.dev>';

  // 첨부파일을 Base64로 인코딩
  const attachmentData = [];
  for (const attachment of attachments) {
    try {
      const content = await fs.readFile(attachment.path);
      attachmentData.push({
        filename: attachment.filename,
        content: content,
      });
    } catch (error) {
      console.warn(`⚠️ 첨부파일 읽기 실패: ${attachment.path}`);
    }
  }

  // 재시도 로직
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📧 이메일 발송 시도 ${attempt}/${maxRetries}...`);

      const result = await resend.emails.send({
        from,
        to,
        subject,
        html,
        attachments: attachmentData,
        headers: {
          'X-Priority': '1',
          'X-MSMail-Priority': 'High',
          'Importance': 'high',
          'X-Mailer': 'Nasdaq AutoTrader System'
        }
      });

      console.log('📧 Resend API 응답:', JSON.stringify(result, null, 2));

      if (result.error) {
        const errorCode = (result.error as any).statusCode || 0;
        console.error('❌ Resend API 에러:', result.error);

        // 500번대 에러는 재시도, 400번대는 즉시 실패
        if (errorCode >= 500 && attempt < maxRetries) {
          const waitTime = 2000 * attempt; // 2초, 4초, 6초
          console.log(`⚠️ 서버 에러(${errorCode}), ${waitTime/1000}초 후 재시도...`);
          await sleep(waitTime);
          lastError = new Error(`Resend API 에러: ${result.error.message || JSON.stringify(result.error)}`);
          continue;
        }

        throw new Error(`Resend API 에러: ${result.error.message || JSON.stringify(result.error)}`);
      }

      if (result.data) {
        console.log('✅ 이메일 ID:', result.data.id);
        console.log(`✅ 이메일 발송 성공 (시도 ${attempt}/${maxRetries})`);
        return; // 성공 시 함수 종료
      }

    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries) {
        const waitTime = 2000 * attempt;
        console.log(`⚠️ 발송 실패 (시도 ${attempt}/${maxRetries}), ${waitTime/1000}초 후 재시도...`);
        await sleep(waitTime);
      }
    }
  }

  // 모든 재시도 실패
  throw lastError || new Error('이메일 발송 실패 (알 수 없는 에러)');
}

/**
 * SMTP를 사용한 이메일 발송 (Gmail, NAVER 등)
 */
async function sendWithSMTP(options: {
  to: string;
  subject: string;
  html: string;
  attachments: Array<{ filename: string; path: string }>;
}): Promise<void> {
  const { to, subject, html, attachments } = options;

  // SMTP 설정 확인
  const requiredEnvVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`${envVar}가 설정되지 않았습니다`);
    }
  }

  // SMTP 전송자 생성
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const from = process.env.MAIL_FROM || process.env.SMTP_USER;

  await transporter.sendMail({
    from,
    to,
    subject,
    html,
    attachments: attachments.map(att => ({
      filename: att.filename,
      path: att.path
    }))
  });
}

/**
 * HTML을 이메일용 템플릿으로 래핑
 */
export function wrapInEmailTemplate(content: string, title: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    h1, h2, h3 { color: #2c3e50; }
    table { border-collapse: collapse; width: 100%; margin: 15px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
    .header { border-bottom: 2px solid #3498db; padding-bottom: 10px; margin-bottom: 20px; }
    .footer { border-top: 1px solid #ddd; padding-top: 20px; margin-top: 30px; font-size: 0.9em; color: #666; }
    .positive { color: #27ae60; font-weight: bold; }
    .negative { color: #e74c3c; font-weight: bold; }
    .neutral { color: #7f8c8d; }
  </style>
</head>
<body>
  <div class="header">
    <h1>📊 ${title}</h1>
    <p><em>생성일시: ${new Date().toLocaleString('ko-KR', { 
      timeZone: 'Asia/Seoul' 
    })}</em></p>
  </div>
  
  ${content}
  
  <div class="footer">
    <p><strong>면책사항:</strong> 본 리포트는 투자자문이 아니며, 모든 투자 결정과 책임은 사용자에게 있습니다.</p>
    <p>Nasdaq AutoTrader System | 📈 Powered by AI</p>
  </div>
</body>
</html>`;
}

/**
 * 파일 존재 확인 헬퍼
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}