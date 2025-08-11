# autotrader/scheduler/jobs.py
from autotrader.utils.logging import get_main_logger
from autotrader.ingest.universe import get_nasdaq_universe
from autotrader.ingest.marketdata_base import get_dummy_prices
from autotrader.ingest.news_base import get_dummy_news
from autotrader.features.indicators import TechnicalIndicatorCalculator
from autotrader.features.sentiment import NewsSentimentAnalyzer
from autotrader.llm.decision_engine import DecisionEngine
from autotrader.broker.kiwoom_stub import KiwoomUSStub
from autotrader.report.render import ReportRenderer
from autotrader.utils.timezones import kst_now
import pandas as pd

logger = get_main_logger(__name__)

def premarket_report_job():
    """
    Job to generate the pre-market report.
    """
    logger.info("Running pre-market report job...")
    
    universe = get_nasdaq_universe()
    market_data = {symbol: get_dummy_prices(symbol) for symbol in universe}
    news_data = get_dummy_news(universe)

    tech_calc = TechnicalIndicatorCalculator()
    sentiment_analyzer = NewsSentimentAnalyzer()
    decision_engine = DecisionEngine()
    report_renderer = ReportRenderer()

    report_content = "# 일일 주식 추천 보고서\n\n"
    current_time_kst = kst_now().strftime("%Y-%m-%d %H:%M:%S KST")
    report_content += f"*생성 시간: {current_time_kst}*\n\n"

    for symbol in universe:
        prices = market_data[symbol]['closes']
        # Convert list of closes to a pandas Series for indicator calculation
        price_series = TechnicalIndicatorCalculator().calculate_rsi(prices=pd.Series(prices))
        technical_indicators = {"RSI": price_series.iloc[-1] if not price_series.empty else "N/A"}

        # Sentiment analysis on news
        symbol_news = news_data.get(symbol, [])
        news_with_sentiment = sentiment_analyzer.analyze_sentiment(symbol_news)

        # Prepare payload for LLM decision
        # Simplified payload for demonstration
        payload_candidates = [{
            "symbol": symbol,
            "latest_price": prices[-1] if prices else "N/A",
            "technical_indicators": technical_indicators,
            "news_sentiment": news_with_sentiment
        }]

        # Dummy market overview and positions for LLM input
        market_overview = {"date": current_time_kst, "trend": "bullish"}
        positions = {"cash": 100000, "holdings": {}}

        decision = decision_engine.make_decision(market_overview, positions, payload_candidates)

        report_content += f"## {symbol}\n\n"
        if decision and decision.get('actions'):
            action = decision['actions'][0] # Assuming one action per symbol for simplicity
            report_content += f"- **결정:** {action.get('decision', 'N/A')}\n"
            report_content += f"- **확신도:** {action.get('confidence', 'N/A')}\n"
            report_content += f"- **근거:** {action.get('reasoning', 'N/A')}\n"
            report_content += f"- **목표 주식 수:** {action.get('target_shares', 'N/A')}\n\n"
        else:
            report_content += "- *LLM으로부터 명확한 결정 없음.*\n\n"
        
        report_content += f"### 최신 가격\n\n`{prices}`\n\n"
        report_content += f"### 뉴스\n\n"
        for news_item in news_with_sentiment:
            report_content += f"- **{news_item['headline']}**: {news_item['summary']} (감성: {news_item['sentiment']:.2f})\n"
        report_content += "\n---\n\n"

    # Render Markdown and PDF
    report_filename = f"daily_report_{kst_now().strftime('%Y%m%d_%H%M')}"
    markdown_filepath = report_renderer.render_markdown_report(
        "일일 주식 추천", report_content, report_filename
    )
    if markdown_filepath:
        report_renderer.render_markdown_to_pdf(markdown_filepath, report_filename)

    logger.info("Pre-market report job completed.")

def intraday_trading_job():
    """
    Job to run the intraday trading decision loop.
    """
    logger.info("Running intraday trading job...")
    
    universe = get_nasdaq_universe()
    market_data = {symbol: get_dummy_prices(symbol) for symbol in universe}
    news_data = get_dummy_news(universe)

    tech_calc = TechnicalIndicatorCalculator()
    sentiment_analyzer = NewsSentimentAnalyzer()
    decision_engine = DecisionEngine()
    broker = KiwoomUSStub()

    for symbol in universe:
        prices = market_data[symbol]['closes']
        price_series = TechnicalIndicatorCalculator().calculate_rsi(prices=pd.Series(prices))
        technical_indicators = {"RSI": price_series.iloc[-1] if not price_series.empty else "N/A"}

        symbol_news = news_data.get(symbol, [])
        news_with_sentiment = sentiment_analyzer.analyze_sentiment(symbol_news)

        payload_candidates = [{
            "symbol": symbol,
            "latest_price": prices[-1] if prices else "N/A",
            "technical_indicators": technical_indicators,
            "news_sentiment": news_with_sentiment
        }]

        current_time_kst = kst_now().strftime("%Y-%m-%d %H:%M:%S KST")
        market_overview = {"date": current_time_kst, "trend": "bullish"}
        positions = broker.get_positions() # Get actual positions from broker stub

        decision = decision_engine.make_decision(market_overview, positions, payload_candidates)

        if decision and decision.get('actions'):
            for action in decision['actions']:
                if action.get('decision') == "BUY":
                    logger.info(f"[Intraday] BUY decision for {symbol}. Placing order...")
                    broker.place_order(symbol, "BUY", action.get('target_shares', 1))
                elif action.get('decision') == "SELL":
                    logger.info(f"[Intraday] SELL decision for {symbol}. Placing order...")
                    broker.place_order(symbol, "SELL", action.get('target_shares', 1))
                else:
                    logger.info(f"[Intraday] HOLD/SKIP decision for {symbol}.")
        else:
            logger.warning(f"[Intraday] No clear decision from LLM for {symbol}.")

    logger.info("Intraday trading job completed.")