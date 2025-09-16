"""
Google Gemini 서비스
Gemini Pro 모델을 사용한 주식 분석 리포트 생성
"""

import logging
from typing import Dict, Any
import google.generativeai as genai

from nasdaq_auto.core.config import get_settings

logger = logging.getLogger(__name__)


class GeminiService:
    """Google Gemini 서비스"""

    def __init__(self):
        self.settings = get_settings()
        genai.configure(api_key=self.settings.gemini_api_key)
        self.model = genai.GenerativeModel("gemini-2.5-pro")

    async def test_connection(self) -> bool:
        """Gemini API 연결 테스트"""
        try:
            response = self.model.generate_content("Hello")
            return bool(response.text)
        except Exception as e:
            logger.error(f"Gemini 연결 테스트 실패: {e}")
            return False

    async def generate_report(self, report_data: Dict[str, Any]) -> str:
        """Agent_Gemini 리포트 생성"""
        logger.info("🤖 Agent_Gemini 리포트 생성 시작")

        try:
            # 프롬프트 구성
            prompt = self._build_prompt(report_data)

            # Gemini API 호출
            response = self.model.generate_content(prompt)
            content = response.text

            logger.info("✅ Agent_Gemini 리포트 생성 완료")
            return content

        except Exception as e:
            logger.error(f"❌ Agent_Gemini 리포트 생성 실패: {e}")
            raise

    def _build_prompt(self, report_data: Dict[str, Any]) -> str:
        """Gemini 프롬프트 구성"""
        prompt_parts = []

        # 시스템 프롬프트
        prompt_parts.append("""당신은 Agent_Gemini입니다. 주식 시장 분석 전문가로서 포트폴리오 분석 및 투자 권고를 제공합니다.

주요 역할:
1. 뉴스 및 센티먼트 분석 중심의 시장 해석
2. 거시경제 트렌드와 개별 종목 연관성 분석
3. 1년 내 1000만원 목표 달성을 위한 전략 수립
4. 시장 심리 및 투자자 행동 분석

분석 시 고려사항:
- 최신 뉴스 및 시장 동향 반영
- 섹터별 로테이션 및 테마주 분석
- 글로벌 경제 이벤트 영향도
- 투자 심리 및 변동성 요인""")

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

        return "\n\n".join(prompt_parts)