"""
OpenAI GPT 서비스
GPT-5 모델을 사용한 주식 분석 리포트 생성
"""

import logging
from typing import Dict, Any, Optional
from openai import AsyncOpenAI

from nasdaq_auto.core.config import get_settings

logger = logging.getLogger(__name__)


class OpenAIService:
    """OpenAI GPT 서비스"""

    def __init__(self):
        self.settings = get_settings()
        self.client = AsyncOpenAI(api_key=self.settings.openai_api_key)
        self.model = "gpt-5"  # GPT-5 모델 사용
        self.max_tokens = 15000  # 토큰 한도

    async def test_connection(self) -> bool:
        """OpenAI API 연결 테스트"""
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": "Hello"}],
                max_tokens=10
            )
            return bool(response.choices[0].message.content)
        except Exception as e:
            logger.error(f"OpenAI 연결 테스트 실패: {e}")
            return False

    async def generate_report(self, report_data: Dict[str, Any]) -> str:
        """Agent_GPT 리포트 생성"""
        logger.info("🤖 Agent_GPT 리포트 생성 시작")

        try:
            # 프롬프트 구성
            system_prompt = self._build_system_prompt()
            user_prompt = self._build_user_prompt(report_data)

            # GPT API 호출
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=self.max_tokens,
                temperature=0.7
            )

            content = response.choices[0].message.content

            # 토큰 사용량 로그
            usage = response.usage
            logger.info(f"📊 GPT 토큰 사용량 - 입력: {usage.prompt_tokens}, 출력: {usage.completion_tokens}, 총: {usage.total_tokens}")

            return content

        except Exception as e:
            logger.error(f"❌ Agent_GPT 리포트 생성 실패: {e}")
            raise

    async def generate_manager_report(self, report_data: Dict[str, Any]) -> str:
        """Manager Agent 리포트 생성"""
        logger.info("🏆 Manager Agent 리포트 생성 시작")

        try:
            # Manager 전용 프롬프트 구성
            system_prompt = "당신은 Manager_Agent입니다. 3개 Agent의 주간 보고서를 종합하여 최종 투자 의사결정을 내리는 포트폴리오 매니저입니다."
            user_prompt = self._build_manager_prompt(report_data)

            # GPT API 호출
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=self.max_tokens,
                temperature=0.7
            )

            content = response.choices[0].message.content

            # 토큰 사용량 로그
            usage = response.usage
            logger.info(f"📊 Manager GPT 토큰 사용량 - 입력: {usage.prompt_tokens}, 출력: {usage.completion_tokens}, 총: {usage.total_tokens}")

            return content

        except Exception as e:
            logger.error(f"❌ Manager Agent 리포트 생성 실패: {e}")
            raise

    def _build_system_prompt(self) -> str:
        """Agent_GPT 시스템 프롬프트 구성"""
        return """당신은 Agent_GPT입니다. 주식 시장 분석 전문가로서 포트폴리오 분석 및 투자 권고를 제공합니다.

주요 역할:
1. 포트폴리오 현황 분석
2. 기술적/기본적 분석을 통한 매매 제안
3. 1년 내 1000만원 목표 달성을 위한 전략 수립
4. 위험 관리 및 수익률 최적화

분석 시 고려사항:
- 현실적이고 구체적인 매매 제안
- 세금 및 수수료 고려
- 환율 리스크 분석
- 단기/중기 목표가 설정
- 손절/익절 기준 명확화"""

    def _build_user_prompt(self, report_data: Dict[str, Any]) -> str:
        """Agent_GPT 사용자 프롬프트 구성"""
        # 리포트 페이로드 구성 (TypeScript 버전과 동일한 구조)
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

    def _build_manager_prompt(self, report_data: Dict[str, Any]) -> str:
        """Manager Agent 프롬프트 구성"""
        prompt_parts = []

        # Manager 프롬프트
        prompt_parts.append(report_data.get("manager_prompt", ""))

        # 포트폴리오 데이터
        portfolio = report_data.get("portfolio", {})
        prompt_parts.append(f"portfolio: {portfolio}")

        # 현재가 데이터
        current_prices = report_data.get("current_prices", {})
        prompt_parts.append(f"currentPrices: {current_prices}")

        # 환율
        exchange_rate = report_data.get("exchange_rate", 0)
        prompt_parts.append(f"exchange_rate: {exchange_rate}")

        # 각 에이전트 리포트
        agent_reports = {
            "agent_gpt": report_data.get("agent_gpt_report", ""),
            "agent_gemini": report_data.get("agent_gemini_report", ""),
            "agent_claude": report_data.get("agent_claude_report", "")
        }

        for agent_name, report_content in agent_reports.items():
            if report_content:
                prompt_parts.append(f"{agent_name}_report: {report_content}")

        return "\n".join(prompt_parts)