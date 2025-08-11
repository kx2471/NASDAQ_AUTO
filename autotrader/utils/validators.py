# autotrader/utils/validators.py
import json
from typing import Dict, Any

# This is a simplified validator. For production, consider using a library like jsonschema.
def validate_json(data: Dict[str, Any], schema: Dict[str, Any]) -> bool:
    """
    Validates a JSON object against a simple schema.

    Args:
        data: The JSON object (as a dict) to validate.
        schema: The schema to validate against.

    Returns:
        True if valid, False otherwise.
    """
    for key, value_type in schema.items():
        if key not in data:
            return False
        if not isinstance(data[key], value_type):
            return False
    return True


def get_decision_schema() -> Dict[str, Any]:
    """
    Returns the schema for the LLM's trading decision.
    """
    return {
        "symbol": str,
        "decision": str,  # "BUY", "SELL", "HOLD"
        "confidence": float,
        "reasoning": str,
        "price_target": float,
        "stop_loss": float
    }
