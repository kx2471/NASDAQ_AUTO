# autotrader/ingest/universe.py
from typing import List

def get_nasdaq_universe() -> List[str]:
    """
    Returns a hardcoded list of NASDAQ symbols.
    In a real application, this would be dynamically updated.
    """
    return ["AAPL", "GOOGL", "MSFT", "AMZN", "TSLA"]