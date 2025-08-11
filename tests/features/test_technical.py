# tests/features/test_technical.py
import pytest
import pandas as pd
from autotrader.features.technical import TechnicalIndicatorCalculator

def test_calculate_rsi():
    """
    Tests the RSI calculation.
    """
    calculator = TechnicalIndicatorCalculator()
    # Sample data for RSI calculation (simplified)
    prices = pd.Series([
        10, 11, 12, 11, 10, 12, 13, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15, 16
    ])
    rsi = calculator.calculate_rsi(prices, period=3)

    # Basic check: RSI should be a pandas Series and not all NaNs
    assert isinstance(rsi, pd.Series)
    assert not rsi.isnull().all()
    # More rigorous tests would involve comparing with known RSI values for specific data sets.

