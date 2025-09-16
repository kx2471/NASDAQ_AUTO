"""
AI 에이전트 서비스 통합 관리
GPT, Gemini, Claude 3개 에이전트 + Manager Agent 조정
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Optional
from pathlib import Path

from nasdaq_auto.core.config import get_settings
from nasdaq_auto.services.ai.openai_service import OpenAIService
from nasdaq_auto.services.ai.gemini_service import GeminiService
from nasdaq_auto.services.ai.claude_service import ClaudeService
from nasdaq_auto.services.market.data_provider import MarketDataProvider
from nasdaq_auto.services.storage.portfolio_storage import PortfolioStorage
from nasdaq_auto.services.storage.report_storage import ReportStorage
from nasdaq_auto.services.performance import calculate_performance, analyze_target_progress, generate_performance_report
from nasdaq_auto.models.reports import AgentReportResponse

logger = logging.getLogger(__name__)


class AgentService:
    """AI 에이전트 서비스 통합 관리자"""

    def __init__(self):
        self.settings = get_settings()
        self.portfolio_storage = PortfolioStorage()
        self.report_storage = ReportStorage()
        self.market_provider = MarketDataProvider()

        # AI 서비스 초기화
        self.openai_service = OpenAIService()
        self.gemini_service = GeminiService()
        self.claude_service = ClaudeService()

    async def generate_single_report(self, agent_name: str) -> AgentReportResponse:
        """단일 에이전트 리포트 생성"""
        logger.info(f"🤖 {agent_name} 에이전트 리포트 생성 시작")

        try:
            # 공통 데이터 수집
            report_data = await self._collect_report_data()

            # 에이전트별 리포트 생성
            if agent_name.lower() == "gpt":
                content = await self.openai_service.generate_report(report_data)
            elif agent_name.lower() == "gemini":
                content = await self.gemini_service.generate_report(report_data)
            elif agent_name.lower() == "claude":
                content = await self.claude_service.generate_report(report_data)
            else:
                raise ValueError(f"알 수 없는 에이전트: {agent_name}")

            # 리포트 저장
            report = await self.report_storage.save_agent_report(
                agent_name=agent_name,
                content=content
            )

            logger.info(f"✅ {agent_name} 리포트 생성 완료")
            return report

        except Exception as e:
            logger.error(f"❌ {agent_name} 리포트 생성 실패: {e}")
            raise

    async def generate_all_reports(self) -> Dict[str, AgentReportResponse]:
        """모든 에이전트 리포트 생성 (순차 실행)"""
        logger.info("🚀 모든 에이전트 리포트 생성 시작")

        results = {}
        agents = ["claude", "gpt", "gemini"]  # TypeScript 버전과 동일한 순서

        for agent in agents:
            try:
                report = await self.generate_single_report(agent)
                results[agent] = report
                logger.info(f"✅ {agent} 리포트 완료")

                # 에이전트 간 간격 (API 레이트 리밋 고려)
                await asyncio.sleep(2)

            except Exception as e:
                logger.error(f"❌ {agent} 리포트 실패: {e}")
                results[agent] = None

        # Manager Agent 리포트 생성
        try:
            manager_report = await self.generate_manager_report()
            results["manager"] = manager_report
            logger.info("✅ Manager 리포트 완료")
        except Exception as e:
            logger.error(f"❌ Manager 리포트 실패: {e}")
            results["manager"] = None

        logger.info("🎉 모든 에이전트 리포트 생성 완료")
        return results

    async def generate_manager_report(self) -> AgentReportResponse:
        """Manager Agent 리포트 생성"""
        logger.info("🏆 Manager Agent 리포트 생성 시작")

        try:
            # 최신 에이전트 리포트들 수집
            latest_reports = self.report_storage.get_latest_reports()

            if not all(latest_reports.get(agent) for agent in ["gpt", "gemini", "claude"]):
                raise ValueError("모든 에이전트 리포트가 필요합니다")

            # Manager용 공통 데이터 수집
            report_data = await self._collect_report_data()

            # Manager 프롬프트 로드
            manager_prompt = self._load_manager_prompt()

            # 에이전트 리포트 내용 추가
            report_data.update({
                "agent_gpt_report": latest_reports["gpt"],
                "agent_gemini_report": latest_reports["gemini"],
                "agent_claude_report": latest_reports["claude"],
                "manager_prompt": manager_prompt
            })

            # Manager 리포트 생성 (GPT 사용)
            content = await self.openai_service.generate_manager_report(report_data)

            # 리포트 저장
            report = await self.report_storage.save_agent_report(
                agent_name="manager",
                content=content
            )

            logger.info("✅ Manager 리포트 생성 완료")
            return report

        except Exception as e:
            logger.error(f"❌ Manager 리포트 생성 실패: {e}")
            raise

    async def _collect_report_data(self) -> Dict:
        """리포트 생성용 공통 데이터 수집"""
        logger.info("📊 리포트 데이터 수집 시작")

        # 포트폴리오 정보
        portfolio = self.portfolio_storage.get_current_portfolio()

        # 보유 종목의 현재가 및 기술 지표
        current_prices = {}
        indicators = {}

        if portfolio.holdings:
            symbols = [holding.symbol for holding in portfolio.holdings]

            # 현재가 가져오기
            current_prices = await self.market_provider.get_current_prices(symbols)

            # 기술 지표 가져오기
            indicators = await self.market_provider.get_technical_indicators(symbols)

        # 환율 정보
        exchange_rate = await self.market_provider.get_exchange_rate()

        # 성과 계산
        performance = calculate_performance(
            holdings=portfolio.holdings,
            current_prices=current_prices,
            exchange_rate=exchange_rate
        )

        # 목표 분석
        target_analysis = analyze_target_progress(performance)

        # 성과 리포트 생성
        performance_report = generate_performance_report(performance, target_analysis)

        # Agent 프롬프트 로드
        agent_prompt = self._load_agent_prompt()

        return {
            "portfolio": portfolio.dict(),
            "current_prices": current_prices,
            "indicators": indicators,
            "exchange_rate": exchange_rate,
            "performance": performance.dict(),
            "target_analysis": target_analysis.dict(),
            "performance_report": performance_report,
            "agent_prompt": agent_prompt,
            "timestamp": datetime.now().isoformat()
        }

    def _load_agent_prompt(self) -> str:
        """Agent 프롬프트 로드"""
        prompt_path = Path("prompts/prompt.md")
        if prompt_path.exists():
            return prompt_path.read_text(encoding="utf-8")
        else:
            logger.warning("Agent 프롬프트 파일을 찾을 수 없음")
            return "기본 리포트를 작성해주세요."

    def _load_manager_prompt(self) -> str:
        """Manager Agent 프롬프트 로드"""
        prompt_path = Path("prompts/promptManagerSimple.md")
        if prompt_path.exists():
            return prompt_path.read_text(encoding="utf-8")
        else:
            logger.warning("Manager 프롬프트 파일을 찾을 수 없음")
            return "3개 Agent의 보고서를 종합하여 최종 투자 의사결정을 내려주세요."

    async def get_agent_status(self) -> Dict[str, bool]:
        """각 AI 서비스의 연결 상태 확인"""
        status = {}

        try:
            status["openai"] = await self.openai_service.test_connection()
        except Exception as e:
            logger.error(f"OpenAI 연결 테스트 실패: {e}")
            status["openai"] = False

        try:
            status["gemini"] = await self.gemini_service.test_connection()
        except Exception as e:
            logger.error(f"Gemini 연결 테스트 실패: {e}")
            status["gemini"] = False

        try:
            status["claude"] = await self.claude_service.test_connection()
        except Exception as e:
            logger.error(f"Claude 연결 테스트 실패: {e}")
            status["claude"] = False

        return status