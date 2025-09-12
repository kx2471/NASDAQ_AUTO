import dotenv from 'dotenv';
import { Resend } from 'resend';

dotenv.config();

async function forceFixClaudeEmail() {
  console.log('🚨 Claude 이메일 강제 해결 시작...');
  
  const resend = new Resend(process.env.RESEND_API_KEY);
  
  // 방법 1: 다른 발신자로 테스트
  const senders = [
    'Claude Stock Bot <claude@resend.dev>',
    'Stock Alert <stock@resend.dev>',
    'AI Report <ai@resend.dev>',
    'Market Analysis <market@resend.dev>'
  ];
  
  for (const sender of senders) {
    try {
      console.log(`📧 테스트 중: ${sender}`);
      
      const result = await resend.emails.send({
        from: sender,
        to: process.env.MAIL_TO,
        subject: `🚨 긴급 테스트 - ${sender}`,
        html: `
          <h1>🚨 Claude 이메일 긴급 테스트</h1>
          <p><strong>발신자:</strong> ${sender}</p>
          <p><strong>테스트 시간:</strong> ${new Date().toLocaleString()}</p>
          <p>이 메일이 도착하면 이 발신자가 작동합니다!</p>
        `,
        headers: {
          'X-Priority': '1',
          'Importance': 'high'
        }
      });
      
      console.log(`✅ ${sender} 전송 성공: ${result.data?.id}`);
      
      // 2초 대기
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.error(`❌ ${sender} 전송 실패:`, error.message);
    }
  }
  
  console.log('\n📬 이메일을 확인하고 어떤 발신자가 도착했는지 알려주세요!');
}

forceFixClaudeEmail().catch(console.error);