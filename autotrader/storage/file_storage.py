# autotrader/storage/file_storage.py
import json
from typing import Any, Dict
import pandas as pd
from autotrader.storage.paths import DATA_DIR
from .base import BaseStorage

class FileStorage(BaseStorage):
    """Implements storage operations for the local filesystem."""

    def save_json(self, data: Dict[str, Any], filename: str):
        """Saves a dictionary to a JSON file in the data directory."""
        filepath = DATA_DIR / f"{filename}.json"
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)

    def load_json(self, filename: str) -> Dict[str, Any]:
        """Loads a dictionary from a JSON file in the data directory."""
        filepath = DATA_DIR / f"{filename}.json"
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)

    def save_df(self, df: pd.DataFrame, filename: str):
        """Saves a pandas DataFrame to a Parquet file in the data directory."""
        filepath = DATA_DIR / f"{filename}.parquet"
        df.to_parquet(filepath)

    def load_df(self, filename: str) -> pd.DataFrame:
        """Loads a pandas DataFrame from a Parquet file in the data directory."""
        filepath = DATA_DIR / f"{filename}.parquet"
        return pd.read_parquet(filepath)
