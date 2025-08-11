# tests/test_app.py
import pytest
from autotrader.app import main
from autotrader.config import config

def test_main_function_runs_without_error(mocker):
    """
    Tests that the main function runs without raising exceptions.
    """
    # Mock dependencies to prevent actual API calls and file writes during test
    mocker.patch('autotrader.ingest.nasdaq.NasdaqDataIngestor.run')
    mocker.patch('autotrader.scheduler.daily_report.generate_daily_report')
    mocker.patch('autotrader.scheduler.trading_loop.run_trading_loop')

    try:
        main()
    except Exception as e:
        pytest.fail(f"main() raised an exception: {e}")

    # Assert that the mocked functions were called
    autotrader.ingest.nasdaq.NasdaqDataIngestor.run.assert_called_once()
    autotrader.scheduler.daily_report.generate_daily_report.assert_called_once()
    # autotrader.scheduler.trading_loop.run_trading_loop.assert_called_once() # This is commented out in app.py

