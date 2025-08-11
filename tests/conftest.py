# tests/conftest.py
import pytest
import os
from autotrader.config import config

@pytest.fixture(scope="session", autouse=True)
def setup_test_environment():
    """
    Sets up the test environment by ensuring necessary directories exist.
    """
    # Ensure test storage directories exist
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    config.LOG_DIR.mkdir(parents=True, exist_ok=True)
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    # Clean up test files after session
    yield
    # For now, we won't clean up to allow inspection of generated files.
    # In a real project, you might want to add cleanup logic here.
