# autotrader/broker/kiwoom_stub.py
from typing import Dict, Any
from autotrader.utils.logging import get_main_logger
from .base import BrokerAdapter

logger = get_main_logger(__name__)

class KiwoomUSStub(BrokerAdapter):
    """
    A stub implementation for Kiwoom US API. Orders are logged but not executed.
    """
    def place_order(self, symbol: str, order_type: str, quantity: int, price: float = None) -> Dict[str, Any]:
        """
        Logs the order details instead of executing it.
        """
        log_message = f"[STUB] Order placed: Symbol={symbol}, Type={order_type}, Quantity={quantity}"
        if price:
            log_message += f", Price={price}"
        logger.info(log_message)
        return {"status": "success", "message": "Order logged, not executed.", "symbol": symbol, "order_type": order_type, "quantity": quantity, "price": price}

    def get_account_info(self) -> Dict[str, Any]:
        """
        Returns dummy account information.
        """
        logger.info("[STUB] Retrieving account info.")
        return {"cash": 100000.0, "equity": 100000.0, "currency": "USD"}

    def get_positions(self) -> Dict[str, Any]:
        """
        Returns dummy position information.
        """
        logger.info("[STUB] Retrieving positions.")
        return {"AAPL": {"quantity": 10, "avg_price": 150.0}}
