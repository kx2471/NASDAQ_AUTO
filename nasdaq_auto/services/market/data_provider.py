"""
Market data provider using yfinance
"""
import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any
from decimal import Decimal

from nasdaq_auto.models.portfolio import MarketData, TechnicalIndicators
from nasdaq_auto.core.config import settings


class MarketDataProvider:
    """Market data provider using Yahoo Finance"""

    def __init__(self):
        self.session = None

    async def get_daily_prices(
        self,
        symbols: List[str],
        period: str = "1y"
    ) -> Dict[str, List[MarketData]]:
        """
        Get daily price data for multiple symbols

        Args:
            symbols: List of stock symbols
            period: Data period (1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max)

        Returns:
            Dictionary mapping symbols to list of MarketData objects
        """
        result = {}

        for symbol in symbols:
            try:
                ticker = yf.Ticker(symbol)
                hist = ticker.history(period=period)

                if hist.empty:
                    print(f"⚠️ No data found for {symbol}")
                    continue

                market_data_list = []
                for date, row in hist.iterrows():
                    market_data = MarketData(
                        symbol=symbol,
                        timestamp=date.to_pydatetime(),
                        open=Decimal(str(row['Open'])),
                        high=Decimal(str(row['High'])),
                        low=Decimal(str(row['Low'])),
                        close=Decimal(str(row['Close'])),
                        volume=int(row['Volume']),
                        adj_close=Decimal(str(row['Close']))  # yfinance already provides adjusted close
                    )
                    market_data_list.append(market_data)

                result[symbol] = market_data_list
                print(f"✅ Fetched {len(market_data_list)} days of data for {symbol}")

            except Exception as e:
                print(f"❌ Error fetching data for {symbol}: {e}")
                result[symbol] = []

        return result

    async def get_current_prices(self, symbols: List[str]) -> Dict[str, Decimal]:
        """
        Get current prices for symbols

        Args:
            symbols: List of stock symbols

        Returns:
            Dictionary mapping symbols to current prices
        """
        result = {}

        try:
            # Use yfinance to get current data
            tickers = yf.Tickers(' '.join(symbols))

            for symbol in symbols:
                try:
                    ticker = tickers.tickers[symbol]
                    info = ticker.fast_info

                    if hasattr(info, 'last_price') and info.last_price:
                        result[symbol] = Decimal(str(info.last_price))
                    else:
                        # Fallback to recent history
                        hist = ticker.history(period="1d")
                        if not hist.empty:
                            result[symbol] = Decimal(str(hist['Close'].iloc[-1]))
                        else:
                            print(f"⚠️ No current price data for {symbol}")

                except Exception as e:
                    print(f"❌ Error getting current price for {symbol}: {e}")

        except Exception as e:
            print(f"❌ Error in batch price fetch: {e}")

        return result

    async def get_company_info(self, symbol: str) -> Optional[Dict[str, Any]]:
        """
        Get company information

        Args:
            symbol: Stock symbol

        Returns:
            Company information dictionary
        """
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info

            return {
                'symbol': symbol,
                'company_name': info.get('longName', symbol),
                'sector': info.get('sector', 'Unknown'),
                'industry': info.get('industry', 'Unknown'),
                'market_cap': info.get('marketCap'),
                'pe_ratio': info.get('trailingPE'),
                'forward_pe': info.get('forwardPE'),
                'price_to_book': info.get('priceToBook'),
                'dividend_yield': info.get('dividendYield'),
                'beta': info.get('beta'),
                'fifty_two_week_high': info.get('fiftyTwoWeekHigh'),
                'fifty_two_week_low': info.get('fiftyTwoWeekLow'),
                'description': info.get('longBusinessSummary', '')[:500] + '...' if info.get('longBusinessSummary') else None
            }

        except Exception as e:
            print(f"❌ Error getting company info for {symbol}: {e}")
            return None

    def calculate_returns(self, prices: List[MarketData]) -> Dict[str, float]:
        """
        Calculate various return metrics

        Args:
            prices: List of MarketData objects

        Returns:
            Dictionary of return metrics
        """
        if len(prices) < 2:
            return {}

        closes = [float(price.close) for price in prices]
        df = pd.Series(closes)

        # Calculate returns
        daily_returns = df.pct_change().dropna()

        return {
            'total_return': (closes[-1] - closes[0]) / closes[0],
            'daily_return': daily_returns.iloc[-1] if len(daily_returns) > 0 else 0,
            'volatility': daily_returns.std() * np.sqrt(252),  # Annualized volatility
            'sharpe_ratio': (daily_returns.mean() * 252) / (daily_returns.std() * np.sqrt(252)) if daily_returns.std() > 0 else 0,
            'max_drawdown': self._calculate_max_drawdown(df),
            'cumulative_return': (closes[-1] / closes[0]) - 1,
        }

    def _calculate_max_drawdown(self, prices: pd.Series) -> float:
        """Calculate maximum drawdown"""
        cumulative = (1 + prices.pct_change()).cumprod()
        running_max = cumulative.expanding().max()
        drawdown = (cumulative - running_max) / running_max
        return drawdown.min()

    async def is_market_open(self) -> bool:
        """
        Check if market is currently open

        Returns:
            True if market is open, False otherwise
        """
        try:
            # Get SPY data to check market status
            spy = yf.Ticker("SPY")
            hist = spy.history(period="1d", interval="1m")

            if hist.empty:
                return False

            # If we got recent minute data, market is likely open
            last_timestamp = hist.index[-1].tz_localize(None)
            now = datetime.now()

            # If last data is within 5 minutes, consider market open
            return (now - last_timestamp).total_seconds() < 300

        except Exception as e:
            print(f"❌ Error checking market status: {e}")
            return False

    async def get_market_holidays(self, year: Optional[int] = None) -> List[datetime]:
        """
        Get market holidays for a given year

        Args:
            year: Year to get holidays for (default: current year)

        Returns:
            List of holiday dates
        """
        if year is None:
            year = datetime.now().year

        # US market holidays (simplified)
        holidays = [
            datetime(year, 1, 1),   # New Year's Day
            datetime(year, 7, 4),   # Independence Day
            datetime(year, 12, 25), # Christmas Day
        ]

        # Add other holidays based on rules
        # Memorial Day (last Monday in May)
        may_last_monday = self._get_last_monday_of_month(year, 5)
        holidays.append(may_last_monday)

        # Labor Day (first Monday in September)
        sep_first_monday = self._get_first_monday_of_month(year, 9)
        holidays.append(sep_first_monday)

        # Thanksgiving (fourth Thursday in November)
        nov_fourth_thursday = self._get_nth_weekday(year, 11, 3, 4)  # 3=Thursday, 4=fourth
        holidays.append(nov_fourth_thursday)

        return sorted(holidays)

    def _get_last_monday_of_month(self, year: int, month: int) -> datetime:
        """Get the last Monday of a given month"""
        # Get the last day of the month
        if month == 12:
            last_day = datetime(year + 1, 1, 1) - timedelta(days=1)
        else:
            last_day = datetime(year, month + 1, 1) - timedelta(days=1)

        # Find the last Monday
        days_since_monday = (last_day.weekday() - 0) % 7
        last_monday = last_day - timedelta(days=days_since_monday)
        return last_monday

    def _get_first_monday_of_month(self, year: int, month: int) -> datetime:
        """Get the first Monday of a given month"""
        first_day = datetime(year, month, 1)
        days_until_monday = (7 - first_day.weekday()) % 7
        if first_day.weekday() != 0:  # If not already Monday
            days_until_monday = (7 - first_day.weekday()) % 7
        first_monday = first_day + timedelta(days=days_until_monday)
        return first_monday

    def _get_nth_weekday(self, year: int, month: int, weekday: int, n: int) -> datetime:
        """Get the nth occurrence of a weekday in a month"""
        first_day = datetime(year, month, 1)
        first_weekday = first_day + timedelta(days=(weekday - first_day.weekday()) % 7)
        nth_weekday = first_weekday + timedelta(weeks=n-1)
        return nth_weekday