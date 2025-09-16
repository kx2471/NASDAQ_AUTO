"""
이메일 서비스
Resend API를 사용한 리포트 이메일 발송
"""

import logging
from typing import Optional
import httpx

from nasdaq_auto.core.config import get_settings

logger = logging.getLogger(__name__)


class EmailService:
    """이메일 발송 서비스"""

    def __init__(self):
        self.settings = get_settings()
        self.api_key = self.settings.resend_api_key
        self.mail_to = self.settings.mail_to
        self.base_url = "https://api.resend.com"

    async def send_weekly_report(
        self,
        content: str,
        subject: str = "📊 Nasdaq AutoTrader 주간 리포트"
    ) -> bool:
        """주간 리포트 이메일 발송"""
        logger.info("📧 주간 리포트 이메일 발송 시작")

        if not self.api_key or not self.mail_to:
            logger.error("❌ 이메일 설정 누락: RESEND_API_KEY 또는 MAIL_TO")
            return False

        try:
            # 이메일 데이터 구성
            email_data = {
                "from": "Nasdaq AutoTrader <no-reply@nasdaq-autotrader.com>",
                "to": [self.mail_to],
                "subject": subject,
                "html": self._format_html_content(content),
                "text": content  # 플레인 텍스트 버전도 포함
            }

            # Resend API 호출
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/emails",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json=email_data,
                    timeout=30.0
                )

                if response.status_code == 200:
                    result = response.json()
                    logger.info(f"✅ 이메일 발송 성공: {result.get('id', 'unknown')}")
                    return True
                else:
                    logger.error(f"❌ 이메일 발송 실패: {response.status_code} - {response.text}")
                    return False

        except Exception as e:
            logger.error(f"❌ 이메일 발송 중 오류: {e}")
            return False

    def _format_html_content(self, content: str) -> str:
        """마크다운 컨텐츠를 HTML로 변환"""
        # 간단한 마크다운 -> HTML 변환
        html_content = content

        # 제목 변환
        html_content = html_content.replace("# ", "<h1>").replace("\n## ", "</h1>\n<h2>").replace("\n### ", "</h2>\n<h3>")

        # 볼드 텍스트
        import re
        html_content = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', html_content)

        # 이모지와 특수 문자 유지
        # 줄바꿈을 <br>로 변환
        html_content = html_content.replace('\n', '<br>\n')

        # 테이블 변환 (간단한 형태)
        lines = html_content.split('<br>\n')
        in_table = False
        table_lines = []
        result_lines = []

        for line in lines:
            if '|' in line and line.strip().startswith('|'):
                if not in_table:
                    in_table = True
                    table_lines = ['<table border="1" style="border-collapse: collapse; width: 100%; margin: 10px 0;">']

                # 테이블 행 처리
                cells = [cell.strip() for cell in line.split('|')[1:-1]]  # 첫 번째와 마지막 빈 요소 제거
                if len(table_lines) == 1:  # 헤더 행
                    table_lines.append('<tr style="background-color: #f0f0f0;">')
                    for cell in cells:
                        table_lines.append(f'<th style="padding: 8px; text-align: left;">{cell}</th>')
                    table_lines.append('</tr>')
                else:  # 데이터 행
                    table_lines.append('<tr>')
                    for cell in cells:
                        table_lines.append(f'<td style="padding: 8px;">{cell}</td>')
                    table_lines.append('</tr>')
            else:
                if in_table:
                    table_lines.append('</table>')
                    result_lines.extend(table_lines)
                    table_lines = []
                    in_table = False
                result_lines.append(line)

        if in_table:
            table_lines.append('</table>')
            result_lines.extend(table_lines)

        html_content = '<br>\n'.join(result_lines)

        # 최종 HTML 템플릿
        return f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{self.settings.app_name} 주간 리포트</title>
    <style>
        body {{
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }}
        h1, h2, h3 {{
            color: #2c3e50;
        }}
        table {{
            border-collapse: collapse;
            width: 100%;
            margin: 15px 0;
        }}
        th, td {{
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }}
        th {{
            background-color: #f2f2f2;
            font-weight: bold;
        }}
        .highlight {{
            background-color: #fff3cd;
            padding: 10px;
            border-radius: 4px;
            margin: 10px 0;
        }}
        .footer {{
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            font-size: 0.9em;
            color: #666;
        }}
    </style>
</head>
<body>
    <div>
        {html_content}
    </div>
    <div class="footer">
        <p>이 리포트는 {self.settings.app_name}에 의해 자동 생성되었습니다.</p>
        <p>문의사항이 있으시면 이 이메일에 회신해 주세요.</p>
    </div>
</body>
</html>
"""

    async def test_connection(self) -> bool:
        """이메일 서비스 연결 테스트"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/domains",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                    },
                    timeout=10.0
                )
                return response.status_code in [200, 401]  # 401도 연결은 된 것
        except Exception as e:
            logger.error(f"이메일 서비스 연결 테스트 실패: {e}")
            return False