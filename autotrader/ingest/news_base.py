# autotrader/ingest/news_base.py
from typing import List, Dict, Any

def get_dummy_news(symbols: List[str]) -> Dict[str, List[Dict[str, Any]]]:
    """
    Returns dummy news data for given symbols.
    """
    news_data = {}
    for symbol in symbols:
        news_data[symbol] = [
            {
                "headline": f"{symbol} announces Q3 earnings.",
                "source": "Dummy News",
                "published_at": "2023-10-26T10:00:00Z",
                "summary": f"Dummy summary for {symbol} earnings."
            },
            {
                "headline": f"{symbol} stock movement today.",
                "source": "Dummy News",
                "published_at": "2023-10-26T11:30:00Z",
                "summary": f"Dummy summary for {symbol} stock movement."
            }
        ]
    return news_data
