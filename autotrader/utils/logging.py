# autotrader/utils/logging.py
import logging
import sys
from pythonjsonlogger import jsonlogger
from autotrader.storage.paths import LOG_DIR

def get_main_logger(name: str) -> logging.Logger:
    """
    Initializes and returns a logger with specified name.

    Args:
        name: The name of the logger.

    Returns:
        A configured logger instance.
    """
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    
    # Prevent duplicate handlers
    if logger.hasHandlers():
        return logger

    # Console handler
    handler = logging.StreamHandler(sys.stdout)
    formatter = jsonlogger.JsonFormatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)

    # File handler
    file_handler = logging.FileHandler(LOG_DIR / "app.log")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger
