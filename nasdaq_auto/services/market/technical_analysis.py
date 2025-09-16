"""
Technical analysis service using TA library
"""
import pandas as pd
import numpy as np
import ta
from datetime import datetime
from typing import List, Dict, Optional
from decimal import Decimal

from nasdaq_auto.models.portfolio import MarketData, TechnicalIndicators


class TechnicalAnalysisService:
    """Technical analysis service for calculating indicators"""

    def __init__(self):
        pass

    async def calculate_indicators(
        self,
        price_data: Dict[str, List[MarketData]]
    ) -> Dict[str, TechnicalIndicators]:
        """
        Calculate technical indicators for multiple symbols

        Args:
            price_data: Dictionary mapping symbols to MarketData lists

        Returns:
            Dictionary mapping symbols to TechnicalIndicators
        """
        result = {}

        for symbol, prices in price_data.items():
            if not prices or len(prices) < 50:  # Need enough data for indicators
                print(f"⚠️ Insufficient data for {symbol} ({len(prices) if prices else 0} days)")
                continue

            try:
                indicators = await self._calculate_symbol_indicators(symbol, prices)
                if indicators:
                    result[symbol] = indicators
                    print(f"✅ Calculated indicators for {symbol}")
            except Exception as e:
                print(f"❌ Error calculating indicators for {symbol}: {e}")

        return result

    async def _calculate_symbol_indicators(
        self,
        symbol: str,
        prices: List[MarketData]
    ) -> Optional[TechnicalIndicators]:
        """
        Calculate indicators for a single symbol

        Args:
            symbol: Stock symbol
            prices: List of MarketData objects

        Returns:
            TechnicalIndicators object or None if error
        """
        try:
            # Convert to DataFrame
            df = self._prices_to_dataframe(prices)

            if df.empty or len(df) < 50:
                return None

            # Get the latest data point
            latest = df.iloc[-1]

            # Calculate moving averages
            df['SMA_20'] = ta.trend.sma_indicator(df['Close'], window=20)
            df['SMA_50'] = ta.trend.sma_indicator(df['Close'], window=50)
            df['EMA_20'] = ta.trend.ema_indicator(df['Close'], window=20)
            df['EMA_50'] = ta.trend.ema_indicator(df['Close'], window=50)

            # Calculate momentum indicators
            df['RSI_14'] = ta.momentum.rsi(df['Close'], window=14)

            # MACD
            macd = ta.trend.MACD(df['Close'])
            df['MACD'] = macd.macd()
            df['MACD_Signal'] = macd.macd_signal()
            df['MACD_Histogram'] = macd.macd_diff()

            # Bollinger Bands
            bb = ta.volatility.BollingerBands(df['Close'])
            df['BB_Upper'] = bb.bollinger_hband()
            df['BB_Middle'] = bb.bollinger_mavg()
            df['BB_Lower'] = bb.bollinger_lband()

            # Volume indicators
            df['Volume_SMA_20'] = ta.volume.sma_ease_of_movement(
                df['High'], df['Low'], df['Volume'], window=20
            )

            # Get latest values
            latest_row = df.iloc[-1]

            return TechnicalIndicators(
                symbol=symbol,
                timestamp=latest_row.name.to_pydatetime() if hasattr(latest_row.name, 'to_pydatetime') else datetime.now(),
                close=Decimal(str(latest_row['Close'])),

                # Moving averages
                sma_20=self._safe_decimal(latest_row.get('SMA_20')),
                sma_50=self._safe_decimal(latest_row.get('SMA_50')),
                ema_20=self._safe_decimal(latest_row.get('EMA_20')),
                ema_50=self._safe_decimal(latest_row.get('EMA_50')),

                # Momentum indicators
                rsi_14=self._safe_decimal(latest_row.get('RSI_14')),
                macd=self._safe_decimal(latest_row.get('MACD')),
                macd_signal=self._safe_decimal(latest_row.get('MACD_Signal')),
                macd_histogram=self._safe_decimal(latest_row.get('MACD_Histogram')),

                # Bollinger Bands
                bb_upper=self._safe_decimal(latest_row.get('BB_Upper')),
                bb_middle=self._safe_decimal(latest_row.get('BB_Middle')),
                bb_lower=self._safe_decimal(latest_row.get('BB_Lower')),

                # Volume
                volume_sma_20=self._safe_decimal(latest_row.get('Volume_SMA_20'))
            )

        except Exception as e:
            print(f"❌ Error in _calculate_symbol_indicators for {symbol}: {e}")
            return None

    def _prices_to_dataframe(self, prices: List[MarketData]) -> pd.DataFrame:
        """Convert MarketData list to pandas DataFrame"""
        data = []
        for price in prices:
            data.append({
                'Date': price.timestamp,
                'Open': float(price.open),
                'High': float(price.high),
                'Low': float(price.low),
                'Close': float(price.close),
                'Volume': price.volume
            })

        df = pd.DataFrame(data)
        df['Date'] = pd.to_datetime(df['Date'])
        df.set_index('Date', inplace=True)
        df.sort_index(inplace=True)

        return df

    def _safe_decimal(self, value) -> Optional[Decimal]:
        """Safely convert a value to Decimal, handling NaN and None"""
        if value is None or pd.isna(value):
            return None
        try:
            return Decimal(str(float(value)))
        except (ValueError, TypeError, OverflowError):
            return None

    async def calculate_support_resistance(
        self,
        prices: List[MarketData],
        window: int = 20
    ) -> Dict[str, List[Decimal]]:
        """
        Calculate support and resistance levels

        Args:
            prices: List of MarketData objects
            window: Window size for pivot calculation

        Returns:
            Dictionary with 'support' and 'resistance' levels
        """
        try:
            df = self._prices_to_dataframe(prices)

            if len(df) < window * 2:
                return {'support': [], 'resistance': []}

            # Find pivot highs and lows
            highs = df['High'].rolling(window=window, center=True).max()
            lows = df['Low'].rolling(window=window, center=True).min()

            # Identify pivot points
            pivot_highs = df[(df['High'] == highs) & (df['High'] == df['High'].rolling(window=window).max())]
            pivot_lows = df[(df['Low'] == lows) & (df['Low'] == df['Low'].rolling(window=window).min())]

            # Extract levels
            resistance_levels = [Decimal(str(price)) for price in pivot_highs['High'].tolist()]
            support_levels = [Decimal(str(price)) for price in pivot_lows['Low'].tolist()]

            return {
                'resistance': sorted(resistance_levels, reverse=True)[:5],  # Top 5 resistance levels
                'support': sorted(support_levels)[:5]  # Bottom 5 support levels
            }

        except Exception as e:
            print(f"❌ Error calculating support/resistance: {e}")
            return {'support': [], 'resistance': []}

    async def generate_signals(
        self,
        indicators: TechnicalIndicators
    ) -> Dict[str, str]:
        """
        Generate trading signals based on technical indicators

        Args:
            indicators: TechnicalIndicators object

        Returns:
            Dictionary of signals
        """
        signals = {}

        try:
            # RSI signals
            if indicators.rsi_14:
                if indicators.rsi_14 > 70:
                    signals['rsi'] = 'OVERSOLD_SELL'
                elif indicators.rsi_14 < 30:
                    signals['rsi'] = 'OVERSOLD_BUY'
                else:
                    signals['rsi'] = 'NEUTRAL'

            # Moving average signals
            if indicators.ema_20 and indicators.ema_50:
                if indicators.ema_20 > indicators.ema_50:
                    signals['ma_trend'] = 'BULLISH'
                else:
                    signals['ma_trend'] = 'BEARISH'

            if indicators.close and indicators.ema_20:
                if indicators.close > indicators.ema_20:
                    signals['price_vs_ema20'] = 'ABOVE'
                else:
                    signals['price_vs_ema20'] = 'BELOW'

            # MACD signals
            if indicators.macd and indicators.macd_signal and indicators.macd_histogram:
                if indicators.macd > indicators.macd_signal:
                    signals['macd'] = 'BULLISH'
                else:
                    signals['macd'] = 'BEARISH'

                # MACD histogram trend
                if indicators.macd_histogram > 0:
                    signals['macd_momentum'] = 'INCREASING'
                else:
                    signals['macd_momentum'] = 'DECREASING'

            # Bollinger Bands signals
            if indicators.bb_upper and indicators.bb_lower and indicators.close:
                if indicators.close > indicators.bb_upper:
                    signals['bollinger'] = 'OVERBOUGHT'
                elif indicators.close < indicators.bb_lower:
                    signals['bollinger'] = 'OVERSOLD'
                else:
                    signals['bollinger'] = 'NORMAL'

            # Overall signal
            bullish_signals = sum(1 for signal in signals.values() if 'BULL' in signal or 'BUY' in signal or 'ABOVE' in signal)
            bearish_signals = sum(1 for signal in signals.values() if 'BEAR' in signal or 'SELL' in signal or 'BELOW' in signal)

            if bullish_signals > bearish_signals:
                signals['overall'] = 'BULLISH'
            elif bearish_signals > bullish_signals:
                signals['overall'] = 'BEARISH'
            else:
                signals['overall'] = 'NEUTRAL'

        except Exception as e:
            print(f"❌ Error generating signals: {e}")
            signals['error'] = str(e)

        return signals

    async def calculate_volatility_metrics(
        self,
        prices: List[MarketData],
        periods: List[int] = [10, 20, 30]
    ) -> Dict[str, Decimal]:
        """
        Calculate various volatility metrics

        Args:
            prices: List of MarketData objects
            periods: List of periods to calculate volatility for

        Returns:
            Dictionary of volatility metrics
        """
        try:
            df = self._prices_to_dataframe(prices)

            if len(df) < max(periods):
                return {}

            # Calculate daily returns
            df['Returns'] = df['Close'].pct_change()

            volatility_metrics = {}

            for period in periods:
                if len(df) >= period:
                    # Historical volatility (annualized)
                    vol = df['Returns'].rolling(window=period).std().iloc[-1] * np.sqrt(252)
                    volatility_metrics[f'volatility_{period}d'] = self._safe_decimal(vol)

            # Average True Range (ATR)
            df['TR'] = np.maximum(
                np.maximum(
                    df['High'] - df['Low'],
                    np.abs(df['High'] - df['Close'].shift(1))
                ),
                np.abs(df['Low'] - df['Close'].shift(1))
            )

            atr_14 = df['TR'].rolling(window=14).mean().iloc[-1]
            volatility_metrics['atr_14'] = self._safe_decimal(atr_14)

            return volatility_metrics

        except Exception as e:
            print(f"❌ Error calculating volatility metrics: {e}")
            return {}