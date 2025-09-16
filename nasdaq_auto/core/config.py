"""
Configuration management for Nasdaq Auto
"""
import os
from pathlib import Path
from typing import Dict, Any, Optional
from pydantic import BaseSettings, Field
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class Settings(BaseSettings):
    """Application settings"""

    # App Configuration
    app_name: str = "Nasdaq Auto"
    app_version: str = "2.0.0"
    debug: bool = Field(default=False, env="DEBUG")

    # API Configuration
    api_host: str = Field(default="0.0.0.0", env="API_HOST")
    api_port: int = Field(default=8000, env="API_PORT")

    # Database Configuration
    enable_supabase: bool = Field(default=False, env="ENABLE_SUPABASE_MIGRATION")
    supabase_url: Optional[str] = Field(default=None, env="SUPABASE_URL")
    supabase_service_key: Optional[str] = Field(default=None, env="SUPABASE_SERVICE_ROLE_KEY")

    # AI Services Configuration
    openai_api_key: Optional[str] = Field(default=None, env="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-4", env="OPENAI_MODEL")

    anthropic_api_key: Optional[str] = Field(default=None, env="CLAUDE_API_KEY")
    anthropic_model: str = Field(default="claude-opus-4-1-20250805", env="CLAUDE_MODEL")

    google_api_key: Optional[str] = Field(default=None, env="GEMINI_API_KEY")
    google_model: str = Field(default="gemini-2.5-pro", env="GEMINI_MODEL")

    # Market Data Configuration
    alpha_vantage_key: Optional[str] = Field(default=None, env="ALPHAVANTAGE_API_KEY")
    finnhub_api_key: Optional[str] = Field(default=None, env="FINNHUB_API_KEY")
    newsapi_key: Optional[str] = Field(default=None, env="NEWSAPI_API_KEY")

    # Email Configuration
    mail_provider: str = Field(default="resend", env="MAIL_PROVIDER")
    resend_api_key: Optional[str] = Field(default=None, env="RESEND_API_KEY")
    mail_from: Optional[str] = Field(default=None, env="MAIL_FROM")
    mail_to: Optional[str] = Field(default=None, env="MAIL_TO")

    # Exchange Rate
    usd_krw_rate: float = Field(default=1350.0, env="USD_KRW_RATE")

    # Report Configuration
    report_lookback_days: int = Field(default=30, env="REPORT_LOOKBACK_DAYS")

    # Timezone Configuration
    market_tz: str = Field(default="US/Eastern", env="MARKET_TZ")
    send_tz: str = Field(default="Asia/Seoul", env="SEND_TZ")

    # Paths
    base_dir: Path = Path(__file__).parent.parent.parent
    data_dir: Path = base_dir / "data"
    reports_dir: Path = data_dir / "report"
    agent_reports_dir: Path = data_dir / "agent_reports"
    json_dir: Path = data_dir / "json"
    prompts_dir: Path = base_dir / "prompts"

    class Config:
        env_file = ".env"
        case_sensitive = False

# Global settings instance
settings = Settings()

# Ensure data directories exist
def ensure_directories():
    """Create necessary directories if they don't exist"""
    directories = [
        settings.data_dir,
        settings.reports_dir,
        settings.agent_reports_dir,
        settings.json_dir,
        settings.prompts_dir,
    ]

    for directory in directories:
        directory.mkdir(parents=True, exist_ok=True)

# Initialize directories
ensure_directories()

# Sector configuration
SECTORS = {
    "ai": {
        "name": "AI & Machine Learning",
        "symbols": [
            "NVDA", "AMD", "GOOGL", "MSFT", "TSLA", "META", "AMZN",
            "AAPL", "ADBE", "CRM", "NOW", "PLTR", "AI"
        ]
    },
    "computing": {
        "name": "Cloud & Computing",
        "symbols": [
            "MSFT", "GOOGL", "AMZN", "ORCL", "IBM", "CSCO", "INTC",
            "QCOM", "BABA", "CRM", "NOW", "SNOW", "DDOG", "NET",
            "OKTA", "ZS", "CRWD", "S", "TWLO", "ZM", "DOCU",
            "WDAY", "VEEV", "SPLK", "COUP", "BILL", "ZI", "FIVN",
            "TENB", "ESTC", "SUMO", "PING", "SMAR", "APPN", "NCNO",
            "GTLB", "PD", "MNDY", "ASAN", "TEAM", "ATLASSIAN", "UBER", "LYFT", "DASH"
        ]
    },
    "nuclear": {
        "name": "Nuclear & Clean Energy",
        "symbols": [
            "NEE", "DUK", "SO", "EXC", "SRE", "AEP", "XEL", "ED",
            "ETR", "ES", "FE", "EIX", "PPL", "AEE", "LNT", "EVRG",
            "PNW", "CMS", "NI", "CCEP", "LEU", "UEC", "UUUU", "DNN"
        ]
    },
    "technology": {
        "name": "Technology & Innovation",
        "symbols": [
            "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "NFLX",
            "ADBE", "PYPL", "INTC", "CSCO", "ORCL", "QCOM", "TXN"
        ]
    },
    "aerospace": {
        "name": "Aerospace & Satellite",
        "symbols": [
            "BA", "LMT", "RTX", "NOC", "GD", "TDG", "LHX", "TXT",
            "AXON", "HWM", "SPR", "CW", "WWD", "AIR", "ESLT", "IRDM",
            "VSAT", "GSAT", "ORBC", "LUNR"
        ]
    },
    "defense": {
        "name": "Defense & Security",
        "symbols": [
            "LMT", "RTX", "NOC", "GD", "BA", "LHX", "TDG", "TXT",
            "KTOS", "AVAV", "PLTR", "CRWD", "ZS", "OKTA", "PANW"
        ]
    }
}

def get_sectors() -> Dict[str, Any]:
    """Get sector configuration"""
    return SECTORS

def get_all_symbols() -> list[str]:
    """Get all unique symbols across all sectors"""
    all_symbols = set()
    for sector_data in SECTORS.values():
        all_symbols.update(sector_data["symbols"])
    return sorted(list(all_symbols))