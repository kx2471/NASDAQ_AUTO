"""
OpenAI GPT service for investment report generation
"""
import asyncio
from datetime import datetime
from typing import Optional, Dict, Any
from openai import AsyncOpenAI

from nasdaq_auto.core.config import settings
from nasdaq_auto.models.reports import AgentReport, AgentType


class OpenAIService:
    """OpenAI GPT service for generating investment reports"""

    def __init__(self):
        if not settings.openai_api_key:
            raise ValueError("OpenAI API key not found in settings")

        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.openai_model
        self.max_tokens = 15000  # GPT-5 token limit from original

    async def generate_report(self, report_payload: Dict[str, Any]) -> AgentReport:
        """
        Generate investment report using OpenAI GPT

        Args:
            report_payload: Complete report data payload

        Returns:
            AgentReport object with generated content
        """
        try:
            print(f"🤖 {self.model}를 사용하여 보고서 생성 중...")

            # Create prompt from payload
            prompt = await self._create_investment_prompt(report_payload)

            # Call OpenAI API
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "당신은 전문적인 투자 분석가입니다. 한국어로 상세하고 실용적인 투자 리포트를 작성해주세요."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                max_tokens=self.max_tokens,
                temperature=0.7,
                top_p=0.9
            )

            # Extract response
            if not response.choices or not response.choices[0].message.content:
                raise ValueError("Empty response from OpenAI API")

            content = response.choices[0].message.content.strip()

            # Extract token usage
            token_usage = {
                "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                "completion_tokens": response.usage.completion_tokens if response.usage else 0,
                "total_tokens": response.usage.total_tokens if response.usage else 0
            }

            print(f"✅ {self.model} 보고서 생성 성공! (토큰: {token_usage['total_tokens']})")

            return AgentReport(
                agent_type=AgentType.GPT,
                content=content,
                generation_time=datetime.now(),
                model_used=self.model,
                token_usage=token_usage,
                success=True
            )

        except Exception as e:
            error_msg = f"OpenAI 리포트 생성 실패: {str(e)}"
            print(f"❌ {error_msg}")

            return AgentReport(
                agent_type=AgentType.GPT,
                content=self._generate_fallback_report(report_payload),
                generation_time=datetime.now(),
                model_used=self.model,
                success=False,
                error_message=error_msg
            )

    async def _create_investment_prompt(self, payload: Dict[str, Any]) -> str:
        """
        Create investment prompt from payload data

        Args:
            payload: Report data payload

        Returns:
            Formatted prompt string
        """
        try:
            # Load prompt template
            prompt_path = settings.prompts_dir / "prompt.md"

            if prompt_path.exists():
                with open(prompt_path, 'r', encoding='utf-8') as f:
                    prompt_template = f.read()
            else:
                prompt_template = self._get_default_prompt_template()

            # Format data context
            data_context = f"""
다음 데이터를 사용하여 리포트를 작성하세요:

**portfolio**: {self._format_json(payload.get('portfolio', {}))}
**indicators**: {self._format_json(payload.get('indicators', {}))}
**currentPrices**: {self._format_json(payload.get('currentPrices', {}))}
**market**: {self._format_json(payload.get('market', {}))}
**scores**: {self._format_json(payload.get('scores', {}))}
**news**: {self._format_json(payload.get('news', [])[:5])}
**performanceReport**: {payload.get('performanceReport', 'N/A')}

{prompt_template}
"""

            return data_context

        except Exception as e:
            print(f"⚠️ 프롬프트 생성 실패, 기본 프롬프트 사용: {e}")
            return self._get_fallback_prompt(payload)

    def _format_json(self, data: Any) -> str:
        """Format data as JSON string"""
        import json
        try:
            return json.dumps(data, indent=2, ensure_ascii=False, default=str)
        except Exception:
            return str(data)

    def _get_default_prompt_template(self) -> str:
        """Get default prompt template"""
        return """
통합 포트폴리오 리포트를 한국어로 작성하세요.

## 구성

**0. 성과 추적** (performanceReport가 있는 경우 포함)
{performanceReport 내용을 그대로 포함}

**1. 포트폴리오 현황**
| 종목 | 수량 | 평단($) | 현재가($) | 평가액($) | 수익률(%) |

⚠️ **데이터 참조 방법 (중요):**
- **보유 종목 정보**: portfolio.holdings 배열에서
  - holdings[].symbol: 종목코드
  - holdings[].shares: 보유 수량
  - holdings[].avg_cost: 평균 매수가격 (평단가)
- **현재가**: currentPrices[symbol] 또는 indicators[symbol].close에서 확인
- **기술지표**: indicators[symbol].rsi14, indicators[symbol].ema20, indicators[symbol].ema50
- **환율**: exchange_rate (USD → KRW 환산용)
- **평가액 계산**: shares × 현재가
- **수익률 계산**: ((현재가 - 평단가) / 평단가) × 100

**2. 시장 분석**
주요 보유 종목들의 기술적 분석 및 시장 동향

**3. 뉴스 분석**
최근 뉴스가 포트폴리오에 미치는 영향 분석

**4. 투자 전략**
현재 상황에 기반한 구체적인 매매 전략

**5. 리스크 관리**
포트폴리오 리스크 요소 및 대응 방안

1000만원 달성을 위한 구체적인 매매 전략과 종목 추천을 포함해주세요.
"""

    def _get_fallback_prompt(self, payload: Dict[str, Any]) -> str:
        """Get fallback prompt when template loading fails"""
        return f"""
다음 데이터를 바탕으로 통합 포트폴리오 리포트를 한국어로 작성하세요.

**보유 종목**: {self._format_json(payload.get('portfolio', {}).get('holdings', []))}
**기술지표**: {self._format_json(payload.get('indicators', {}))}
**뉴스**: {self._format_json(payload.get('news', [])[:5])}
**성과 분석**: {payload.get('performanceReport', 'N/A')}

1000만원 달성을 위한 구체적인 매매 전략과 종목 추천을 포함해주세요.
"""

    def _generate_fallback_report(self, payload: Dict[str, Any]) -> str:
        """Generate fallback report when API fails"""
        today = datetime.now().strftime('%Y-%m-%d')

        holdings = payload.get('portfolio', {}).get('holdings', [])
        news_count = len(payload.get('news', []))

        return f"""# 📊 GPT-5 데일리 투자 리포트 (폴백)

**⚠️ 알림**: OpenAI API 연결 실패로 인한 기본 리포트입니다.

## 📈 분석 요약 ({today})

**보유 종목**: {len(holdings)}개
**수집 뉴스**: {news_count}개

## 🎯 주요 지표

**보유 종목 현황**:
{self._format_holdings_fallback(holdings)}

## ⚠️ 중요 안내

OpenAI API 연결 문제로 상세 분석을 제공할 수 없습니다.
정상 서비스 복구 후 다시 시도하시기 바랍니다.

---
*본 리포트는 기술적 오류로 인한 임시 버전입니다*"""

    def _format_holdings_fallback(self, holdings: list) -> str:
        """Format holdings for fallback report"""
        if not holdings:
            return "보유 종목이 없습니다."

        lines = []
        for i, holding in enumerate(holdings[:5], 1):
            symbol = holding.get('symbol', 'Unknown')
            shares = holding.get('shares', 0)
            avg_cost = holding.get('avg_cost', 0)
            lines.append(f"{i}. {symbol}: {shares}주 (평단가: ${avg_cost:.2f})")

        return '\n'.join(lines)

    async def test_connection(self) -> bool:
        """
        Test OpenAI API connection

        Returns:
            True if connection successful, False otherwise
        """
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "user",
                        "content": "Test connection. Reply with 'OK'"
                    }
                ],
                max_tokens=10
            )

            if response.choices and response.choices[0].message.content:
                content = response.choices[0].message.content.strip()
                return 'OK' in content.upper()

            return False

        except Exception as e:
            print(f"❌ OpenAI 연결 테스트 실패: {e}")
            return False