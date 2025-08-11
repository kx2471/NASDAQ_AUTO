# tests/ingest/test_nasdaq.py
import pytest
from autotrader.ingest.nasdaq import NasdaqDataIngestor
from autotrader.ingest.client import DataClient
from autotrader.storage import storage_client
import pandas as pd

def test_ingest_symbol_data(mocker):
    """
    Tests that ingest_symbol_data correctly fetches and saves data.
    """
    mock_get_price_data = mocker.patch.object(DataClient, 'get_price_data')
    mock_get_news = mocker.patch.object(DataClient, 'get_news')
    mock_save_df = mocker.patch.object(storage_client, 'save_df')
    mock_save_json = mocker.patch.object(storage_client, 'save_json')

    # Mock return values
    mock_get_price_data.return_value = pd.DataFrame({'Close': [100, 101]})
    mock_get_news.return_value = [{'headline': 'Test News'}]

    ingestor = NasdaqDataIngestor()
    ingestor.ingest_symbol_data("TEST")

    mock_get_price_data.assert_called_once_with("TEST")
    mock_get_news.assert_called_once_with("TEST")
    mock_save_df.assert_called_once()
    mock_save_json.assert_called_once()

