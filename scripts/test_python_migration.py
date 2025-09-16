#!/usr/bin/env python3
"""
Python 마이그레이션 테스트 스크립트
새로운 Python 시스템의 주요 기능들을 테스트
"""

import asyncio
import logging
import sys
import os
from pathlib import Path

# 프로젝트 루트를 Python path에 추가
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from nasdaq_auto.core.config import get_settings
from nasdaq_auto.services.storage.portfolio_storage import PortfolioStorage
from nasdaq_auto.services.market.data_provider import MarketDataProvider
from nasdaq_auto.services.ai.agent_service import AgentService
from nasdaq_auto.services.performance import calculate_performance
from nasdaq_auto.scheduler.weekly_job import run_manual_report

# 로깅 설정
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


async def test_configuration():
    """설정 테스트"""
    logger.info("🔧 설정 테스트 시작")

    settings = get_settings()
    logger.info(f"앱 이름: {settings.app_name}")
    logger.info(f"버전: {settings.version}")
    logger.info(f"환경: {settings.environment}")

    # API 키 설정 확인 (값은 노출하지 않음)
    api_checks = {
        "OpenAI": bool(settings.openai_api_key),
        "Gemini": bool(settings.gemini_api_key),
        "Claude": bool(settings.claude_api_key),
        "Resend": bool(settings.resend_api_key)
    }

    for service, configured in api_checks.items():
        status = "✅ 설정됨" if configured else "❌ 미설정"
        logger.info(f"{service} API: {status}")

    logger.info("✅ 설정 테스트 완료\n")


async def test_portfolio_storage():
    """포트폴리오 스토리지 테스트"""
    logger.info("💾 포트폴리오 스토리지 테스트 시작")

    try:
        storage = PortfolioStorage()
        portfolio = storage.get_current_portfolio()

        logger.info(f"현금: ${portfolio.cash:.2f}")
        logger.info(f"보유 종목 수: {len(portfolio.holdings)}")

        for holding in portfolio.holdings:
            logger.info(f"  {holding.symbol}: {holding.shares}주, 평단가 ${holding.avg_cost:.2f}")

        logger.info("✅ 포트폴리오 스토리지 테스트 완료\n")
    except Exception as e:
        logger.error(f"❌ 포트폴리오 스토리지 테스트 실패: {e}\n")


async def test_market_data():
    """시장 데이터 테스트"""
    logger.info("📊 시장 데이터 테스트 시작")

    try:
        provider = MarketDataProvider()

        # 환율 테스트
        exchange_rate = await provider.get_exchange_rate()
        logger.info(f"USD/KRW 환율: {exchange_rate:.2f}")

        # 현재가 테스트 (소수 종목만)
        test_symbols = ["AAPL", "GOOGL"]
        prices = await provider.get_current_prices(test_symbols)

        for symbol, price in prices.items():
            logger.info(f"{symbol} 현재가: ${price:.2f}")

        logger.info("✅ 시장 데이터 테스트 완료\n")
    except Exception as e:
        logger.error(f"❌ 시장 데이터 테스트 실패: {e}\n")


async def test_performance_calculation():
    """성과 계산 테스트"""
    logger.info("📈 성과 계산 테스트 시작")

    try:
        storage = PortfolioStorage()
        portfolio = storage.get_current_portfolio()

        if portfolio.holdings:
            provider = MarketDataProvider()
            symbols = [h.symbol for h in portfolio.holdings]
            current_prices = await provider.get_current_prices(symbols)
            exchange_rate = await provider.get_exchange_rate()

            performance = calculate_performance(
                holdings=portfolio.holdings,
                current_prices=current_prices,
                exchange_rate=exchange_rate
            )

            logger.info(f"투자원금: ₩{performance.total_investment_krw:,}")
            logger.info(f"현재가치: ₩{performance.current_value_krw:,}")
            logger.info(f"수익금: ₩{performance.total_return_krw:,}")
            logger.info(f"수익률: {performance.total_return_percent:.2f}%")
            logger.info(f"목표 진행률: {performance.target_progress:.2f}%")
        else:
            logger.info("보유 종목이 없어 성과 계산을 생략합니다.")

        logger.info("✅ 성과 계산 테스트 완료\n")
    except Exception as e:
        logger.error(f"❌ 성과 계산 테스트 실패: {e}\n")


async def test_ai_connections():
    """AI 서비스 연결 테스트"""
    logger.info("🤖 AI 서비스 연결 테스트 시작")

    try:
        agent_service = AgentService()
        status = await agent_service.get_agent_status()

        for service, connected in status.items():
            status_text = "✅ 연결됨" if connected else "❌ 연결 실패"
            logger.info(f"{service.upper()}: {status_text}")

        logger.info("✅ AI 서비스 연결 테스트 완료\n")
    except Exception as e:
        logger.error(f"❌ AI 서비스 연결 테스트 실패: {e}\n")


async def test_report_generation():
    """리포트 생성 테스트 (선택사항)"""
    logger.info("📝 리포트 생성 테스트")

    # 사용자에게 확인
    response = input("실제 AI 리포트를 생성하시겠습니까? (y/N): ").strip().lower()

    if response == 'y':
        try:
            logger.info("리포트 생성 시작... (시간이 오래 걸릴 수 있습니다)")
            success = await run_manual_report()

            if success:
                logger.info("✅ 리포트 생성 테스트 완료")
            else:
                logger.error("❌ 리포트 생성 실패")
        except Exception as e:
            logger.error(f"❌ 리포트 생성 테스트 실패: {e}")
    else:
        logger.info("⏭️ 리포트 생성 테스트 건너뜀")

    print()


async def main():
    """메인 테스트 함수"""
    logger.info("🚀 Python 마이그레이션 테스트 시작")
    logger.info("=" * 50)

    await test_configuration()
    await test_portfolio_storage()
    await test_market_data()
    await test_performance_calculation()
    await test_ai_connections()
    await test_report_generation()

    logger.info("=" * 50)
    logger.info("🎉 Python 마이그레이션 테스트 완료")


if __name__ == "__main__":
    asyncio.run(main())