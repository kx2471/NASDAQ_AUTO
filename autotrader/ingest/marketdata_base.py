# autotrader/ingest/marketdata_base.py
from typing import List, Dict, Any
import random

def get_dummy_prices(symbol: str) -> Dict[str, Any]:
    """
    Returns dummy historical close prices for a given symbol.
    """
    # Generate 20 random prices between 100 and 200
    closes = [round(random.uniform(100, 200), 2) for _ in range(20)]
    return {"symbol": symbol, "closes": closes}