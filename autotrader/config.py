# autotrader/config.py
import os
from dotenv import load_dotenv
from autotrader.storage.paths import DATA_DIR, REPORTS_DIR, LOG_DIR

# Load environment variables from .env file
load_dotenv()

class Config:
    """
    Configuration class for the application.
    Loads environment variables and defines constants.
    """
    # API Keys
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
    OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4-turbo") # Default to gpt-4-turbo if not set

    ALPHAVANTAGE_API_KEY = os.getenv("ALPHAVANTAGE_API_KEY")
    POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")
    IEXCLOUD_API_KEY = os.getenv("IEXCLOUD_API_KEY")
    FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY")

    KIWOOM_APPKEY = os.getenv("KIWOOM_APPKEY")
    KIWOOM_APPSECRET = os.getenv("KIWOOM_APPSECRET")

    # Storage Paths (from autotrader.storage.paths)
    DATA_DIR = DATA_DIR
    LOG_DIR = LOG_DIR
    REPORTS_DIR = REPORTS_DIR

    # Environment
    ENV = os.getenv("ENV", "dev")

    # LLM Settings
    LLM_TEMPERATURE = 0.7 # Default temperature

# Instantiate config
config = Config()
