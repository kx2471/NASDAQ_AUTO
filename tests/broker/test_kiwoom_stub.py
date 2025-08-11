# tests/broker/test_kiwoom_stub.py
import pytest
from autotrader.broker.kiwoom_stub import KiwoomUSStub
from autotrader.utils.logger import get_logger

def test_place_order_stub(mocker):
    """
    Tests that place_order in the stub logs the action.
    """
    mock_logger_info = mocker.patch.object(get_logger(__name__), 'info')
    stub = KiwoomUSStub()
    result = stub.place_order("AAPL", "BUY", 10)

    mock_logger_info.assert_called_once_with("[STUB] Order placed: Symbol=AAPL, Type=BUY, Quantity=10")
    assert result['status'] == "success"
    assert result['message'] == "Order logged, not executed."

def test_get_account_info_stub(mocker):
    """
    Tests that get_account_info in the stub returns dummy data and logs.
    """
    mock_logger_info = mocker.patch.object(get_logger(__name__), 'info')
    stub = KiwoomUSStub()
    info = stub.get_account_info()

    mock_logger_info.assert_called_once_with("[STUB] Retrieving account info.")
    assert "cash" in info
    assert info['cash'] == 100000.0

def test_get_positions_stub(mocker):
    """
    Tests that get_positions in the stub returns dummy data and logs.
    """
    mock_logger_info = mocker.patch.object(get_logger(__name__), 'info')
    stub = KiwoomUSStub()
    positions = stub.get_positions()

    mock_logger_info.assert_called_once_with("[STUB] Retrieving positions.")
    assert "AAPL" in positions
    assert positions['AAPL']['quantity'] == 10
