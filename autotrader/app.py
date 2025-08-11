# autotrader/app.py
from autotrader.scheduler.jobs import premarket_report_job
from autotrader.utils.logging import get_main_logger
import sys

logger = get_main_logger(__name__)

def main():
    """
    Main entry point for the Nasdaq AutoTrader application.
    """
    logger.info("Starting Nasdaq AutoTrader application...")

    # Run the pre-market report job
    premarket_report_job()

    logger.info("Nasdaq AutoTrader application finished.")

if __name__ == "__main__":
    main()