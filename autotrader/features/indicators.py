# autotrader/features/indicators.py
import pandas as pd

class TechnicalIndicatorCalculator:
    """
    Calculates various technical indicators from price data.
    """
    def calculate_rsi(self, prices: pd.Series, period: int = 14) -> pd.Series:
        """
        Calculates the Relative Strength Index (RSI).
        """
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()

        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        return rsi

    def add_indicators(self, price_df: pd.DataFrame) -> pd.DataFrame:
        """
        Adds all implemented indicators to the price DataFrame.
        """
        df = price_df.copy()
        df['RSI'] = self.calculate_rsi(df['Close'])
        # Add other indicators here
        return df
