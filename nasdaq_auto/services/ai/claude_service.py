"""
Anthropic Claude 서비스
Claude Opus 모델을 사용한 주식 분석 리포트 생성
"""

import logging
from typing import Dict, Any
import anthropic

from nasdaq_auto.core.config import get_settings

logger = logging.getLogger(__name__)


class ClaudeService:
    """Anthropic Claude 서비스"""

    def __init__(self):
        self.settings = get_settings()
        self.client = anthropic.Anthropic(api_key=self.settings.claude_api_key)
        self.model = "claude-opus-4-1-20250805"  # 정확한 모델명 사용
        self.max_tokens = 8192

    async def test_connection(self) -> bool:
        """Claude API 연결 테스트"""
        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=10,
                messages=[{"role": "user", "content": "Hello"}]
            )
            return bool(response.content[0].text)
        except Exception as e:
            logger.error(f"Claude 연결 테스트 실패: {e}")
            return False

    async def generate_report(self, report_data: Dict[str, Any]) -> str:
        """Agent_Claude 리포트 생성"""
        logger.info("🤖 Agent_Claude 리포트 생성 시작")

        try:
            # 프롬프트 구성
            system_prompt = self._build_system_prompt()
            user_prompt = self._build_user_prompt(report_data)

            # Claude API 호출
            response = self.client.messages.create(
                model=self.model,
                max_tokens=self.max_tokens,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}]
            )

            content = response.content[0].text

            # 토큰 사용량 로그
            logger.info(f"📊 Claude 토큰 사용량 - 입력: {response.usage.input_tokens}, 출력: {response.usage.output_tokens}")

            return content

        except Exception as e:
            logger.error(f"❌ Agent_Claude 리포트 생성 실패: {e}")
            raise

    def _build_system_prompt(self) -> str:
        """Agent_Claude 시스템 프롬프트 구성"""
        return """당신은 Agent_Claude입니다. 주식 시장 분석 전문가로서 포트폴리오 분석 및 투자 권고를 제공합니다.

주요 역할:
1. 기술적 분석 중심의 정밀한 차트 해석
2. 리스크 관리 및 포지션 사이징 최적화
3. 1년 내 1000만원 목표 달성을 위한 보수적 전략
4. 데이터 기반의 객관적 분석 제공

분석 시 고려사항:
- RSI, EMA, 볼린저 밴드 등 기술적 지표 활용
- 지지/저항선 및 차트 패턴 분석
- 백테스팅 및 통계적 유의성 검증
- 리스크 조정 수익률 최적화
- 보수적 접근과 안전마진 확보"""

    def _build_user_prompt(self, report_data: Dict[str, Any]) -> str:
        """Agent_Claude 사용자 프롬프트 구성"""
        prompt_parts = []

        # 에이전트 프롬프트
        prompt_parts.append(report_data.get("agent_prompt", ""))

        # 성과 리포트 (있는 경우)
        if report_data.get("performance_report"):
            prompt_parts.append(f"performanceReport: {report_data['performance_report']}")

        # 포트폴리오 데이터
        portfolio = report_data.get("portfolio", {})
        prompt_parts.append(f"portfolio: {portfolio}")

        # 현재가 데이터
        current_prices = report_data.get("current_prices", {})
        prompt_parts.append(f"currentPrices: {current_prices}")

        # 기술 지표
        indicators = report_data.get("indicators", {})
        prompt_parts.append(f"indicators: {indicators}")

        # 환율
        exchange_rate = report_data.get("exchange_rate", 0)
        prompt_parts.append(f"exchange_rate: {exchange_rate}")

        # 성과 데이터
        performance = report_data.get("performance", {})
        for key, value in performance.items():
            prompt_parts.append(f"{key}: {value}")

        return "\n".join(prompt_parts)