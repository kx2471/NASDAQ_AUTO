"""
서비스 테스트
핵심 서비스들의 기본 동작 테스트
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime

from nasdaq_auto.services.storage.portfolio_storage import PortfolioStorage
from nasdaq_auto.services.market.data_provider import MarketDataProvider
from nasdaq_auto.services.performance import calculate_performance, analyze_target_progress
from nasdaq_auto.models.portfolio import TradeType, Holding


class TestPortfolioStorage:
    """포트폴리오 스토리지 테스트"""

    def test_calculate_current_portfolio(self):
        """현재 포트폴리오 계산 테스트"""
        storage = PortfolioStorage()

        # 테스트 데이터
        test_trades = [
            {"symbol": "AAPL", "type": "BUY", "shares": 10, "price": 150.0},
            {"symbol": "AAPL", "type": "BUY", "shares": 5, "price": 160.0},
            {"symbol": "GOOGL", "type": "BUY", "shares": 2, "price": 2800.0},
            {"symbol": "AAPL", "type": "SELL", "shares": 3, "price": 170.0},
        ]

        holdings = storage._calculate_holdings_from_trades(test_trades)

        # AAPL: (10*150 + 5*160 - 3*170) / (10+5-3) = (1500 + 800 - 510) / 12 = 1790/12 ≈ 149.17
        aapl_holding = next(h for h in holdings if h.symbol == "AAPL")
        assert aapl_holding.shares == 12
        assert abs(aapl_holding.avg_cost - 149.17) < 0.01

        # GOOGL: 2800.0 그대로
        googl_holding = next(h for h in holdings if h.symbol == "GOOGL")
        assert googl_holding.shares == 2
        assert googl_holding.avg_cost == 2800.0


class TestPerformanceCalculation:
    """성과 계산 테스트"""

    def test_calculate_performance(self):
        """포트폴리오 성과 계산 테스트"""
        holdings = [
            Holding(symbol="AAPL", shares=10, avg_cost=150.0),
            Holding(symbol="GOOGL", shares=2, avg_cost=2800.0)
        ]

        current_prices = {
            "AAPL": 160.0,  # +10 per share
            "GOOGL": 2900.0  # +100 per share
        }

        exchange_rate = 1300.0

        performance = calculate_performance(
            holdings=holdings,
            current_prices=current_prices,
            exchange_rate=exchange_rate,
            initial_capital_krw=2200000
        )

        # 투자원금: (10*150 + 2*2800) * 1300 = 7100 * 1300 = 9,230,000
        # 현재가치: (10*160 + 2*2900) * 1300 = 7400 * 1300 = 9,620,000
        # 수익: 390,000

        assert performance.total_investment_krw == 9230000
        assert performance.current_value_krw == 9620000
        assert performance.total_return_krw == 390000
        assert abs(performance.total_return_percent - 4.23) < 0.01  # 390000/9230000 * 100

    def test_analyze_target_progress(self):
        """목표 달성 분석 테스트"""
        from nasdaq_auto.services.performance import PerformanceData

        performance = PerformanceData(
            date="2025-09-16",
            total_investment_krw=3000000,
            current_value_krw=3500000,
            total_return_krw=500000,
            total_return_percent=16.67,
            initial_capital_krw=2200000,
            total_return_from_initial_krw=1300000,
            total_return_from_initial_percent=59.09,
            daily_return_krw=0,
            daily_return_percent=0,
            target_progress=35.0
        )

        analysis = analyze_target_progress(performance, "2025-09-10")

        assert analysis.target_amount_krw == 10000000
        assert analysis.current_amount_krw == 3500000
        assert analysis.remaining_amount_krw == 6500000
        assert analysis.progress_percent == 35.0
        assert analysis.is_on_track == True  # 35% > 20% threshold


@pytest.mark.asyncio
class TestMarketDataProvider:
    """시장 데이터 제공자 테스트"""

    @patch('yfinance.download')
    async def test_get_current_prices(self, mock_download):
        """현재가 조회 테스트"""
        # Mock yfinance response
        import pandas as pd
        mock_data = pd.DataFrame({
            ('Close', 'AAPL'): [150.0, 155.0, 160.0],
            ('Close', 'GOOGL'): [2800.0, 2850.0, 2900.0]
        })
        mock_download.return_value = mock_data

        provider = MarketDataProvider()
        prices = await provider.get_current_prices(["AAPL", "GOOGL"])

        assert "AAPL" in prices
        assert "GOOGL" in prices
        assert prices["AAPL"] == 160.0
        assert prices["GOOGL"] == 2900.0

    @patch('yfinance.Ticker')
    async def test_get_exchange_rate(self, mock_ticker):
        """환율 조회 테스트"""
        # Mock ticker response
        mock_info = Mock()
        mock_info.info = {"regularMarketPrice": 1350.0}
        mock_ticker.return_value = mock_info

        provider = MarketDataProvider()
        rate = await provider.get_exchange_rate()

        assert rate == 1350.0


class TestConfigurationAndEnvironment:
    """설정 및 환경 테스트"""

    def test_settings_loading(self):
        """설정 로딩 테스트"""
        from nasdaq_auto.core.config import get_settings

        settings = get_settings()
        assert settings.app_name == "Nasdaq AutoTrader"
        assert settings.version == "2.0.0"
        assert settings.environment in ["development", "production"]

    @patch.dict('os.environ', {
        'OPENAI_API_KEY': 'test-openai-key',
        'GEMINI_API_KEY': 'test-gemini-key',
        'CLAUDE_API_KEY': 'test-claude-key'
    })
    def test_api_keys_configuration(self):
        """API 키 설정 테스트"""
        from nasdaq_auto.core.config import get_settings

        settings = get_settings()
        assert settings.openai_api_key == "test-openai-key"
        assert settings.gemini_api_key == "test-gemini-key"
        assert settings.claude_api_key == "test-claude-key"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])