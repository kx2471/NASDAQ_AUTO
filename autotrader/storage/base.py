# autotrader/storage/base.py
from abc import ABC, abstractmethod
from typing import Any, Dict
import pandas as pd

class BaseStorage(ABC):
    """Abstract base class for storage operations."""

    @abstractmethod
    def save_json(self, data: Dict[str, Any], filename: str):
        """Saves a dictionary to a JSON file."""
        pass

    @abstractmethod
    def load_json(self, filename: str) -> Dict[str, Any]:
        """Loads a dictionary from a JSON file."""
        pass

    @abstractmethod
    def save_df(self, df: pd.DataFrame, filename: str):
        """Saves a pandas DataFrame."""
        pass

    @abstractmethod
    def load_df(self, filename: str) -> pd.DataFrame:
        """Loads a pandas DataFrame."""
        pass
