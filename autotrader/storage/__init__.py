# autotrader/storage/__init__.py
from .file_storage import FileStorage

# You can add other storage types here later, e.g., a database storage
storage_client = FileStorage()
