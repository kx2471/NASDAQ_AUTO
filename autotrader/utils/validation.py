# autotrader/utils/validation.py
import json
from typing import Dict, Any

def validate_json_schema(data: Dict[str, Any], schema: Dict[str, Any]) -> bool:
    """
    Validates a JSON object against a given schema.
    This is a simplified validator. For production, consider using `jsonschema` library.
    """
    # Basic type and key presence validation
    for key, expected_type in schema.items():
        if key not in data:
            return False
        if not isinstance(data[key], expected_type):
            return False
    return True

def get_decision_schema() -> Dict[str, Any]:
    """
    Returns the expected JSON schema for LLM trading decisions.
    """
    return {
        "as_of": str,
        "market_view": str,
        "actions": list,
        "watchlist": list,
        "constraints_check": dict,
        "data_sources": list
    }
