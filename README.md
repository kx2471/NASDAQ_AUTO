# Nasdaq AutoTrader

This is an automated Nasdaq stock trading system project, designed to be expanded from a dummy data-based minimum viable version to a full-fledged service.

## Goal

- Automated daily report generation.
- Intraday decision-making loop (order execution is currently a stub).
- Gradual replacement with real APIs in the future.

## Requirements

- Python 3.10+
- Virtual environment recommended (venv or conda)
- Internet connection (for real data/LLM integration)
- OS: Windows/Mac/Linux

## Installation & Initial Run

1.  **Create/Activate Virtual Environment**
    ```bash
    python -m venv .venv
    # Windows
    .venv\Scripts\activate
    # macOS/Linux
    source .venv/bin/activate
    ```

2.  **Install Dependencies**
    ```bash
    pip install -r requirements.txt
    ```

3.  **Create Environment File**
    ```bash
    cp .env.example .env
    ```
    Fill in the necessary values (you can leave them empty for dummy execution).

4.  **Generate Pre-market Report with Dummy Data**
    ```bash
    python autotrader/app.py
    ```
    Check for `data/reports/daily_report_YYYYMMDD_HHMM.md` and `.pdf` files.

## Project Structure

```
autotrader/
  app.py                      # Entry point (currently runs premarket_report)
  config.py                   # Common settings/.env loader
  requirements.txt
  .env.example
  README.md (this document)

  ingest/
    __init__.py
    universe.py               # Nasdaq universe (symbol list)
    marketdata_base.py        # Market data dummy/future real adapter
    news_base.py              # News dummy/future real adapter

  features/
    __init__.py
    indicators.py             # RSI and other technical indicators

  llm/
    __init__.py
    openai_client.py          # LLM call wrapper (currently Stub)
    decision_engine.py        # Candidate construction/LLM call/result integration

  broker/
    __init__.py
    base.py                   # BrokerAdapter interface
    kiwoom_us_stub.py         # Kiwoom US Stub (logging only)

  report/
    __init__.py
    render.py                 # Markdown/HTML report generation

  scheduler/
    __init__.py
    jobs.py                   # Scheduled jobs (e.g., pre-market report, intraday loop)

  storage/
    __init__.py
    paths.py                  # Defines storage paths
    db.py (optional)          # Database integration (e.g., SQLite)

  utils/
    __init__.py
    timezones.py              # Timezone conversions
    logging.py                # Logging utility
    validation.py             # JSON schema validation

  tests/
    # Unit tests for various modules
```

## Running Tests

```bash
pip install pytest
pytest -q
```