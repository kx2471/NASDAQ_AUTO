# autotrader/broker/base.py
from abc import ABC, abstractmethod
from typing import Dict, Any

class BrokerAdapter(ABC):
    """
    Abstract base class for broker interactions.
    """
    @abstractmethod
    def place_order(self, symbol: str, order_type: str, quantity: int, price: float = None) -> Dict[str, Any]:
        """
        Places a trading order.
        """
        pass

    @abstractmethod
    def get_account_info(self) -> Dict[str, Any]:
        """
        Retrieves account information.
        """
        pass

    @abstractmethod
    def get_positions(self) -> Dict[str, Any]:
        """
        Retrieves current positions.
        """
        pass
