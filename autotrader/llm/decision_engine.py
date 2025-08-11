# autotrader/llm/decision_engine.py
from typing import List, Dict, Any
from autotrader.llm.openai_client import OpenAIClient
from autotrader.utils.logging import get_main_logger

logger = get_main_logger(__name__)

class DecisionEngine:
    """
    Orchestrates the LLM-based decision-making process.
    """
    def __init__(self):
        self.llm_client = OpenAIClient()

    def make_decision(self, market_overview: Dict[str, Any], positions: Dict[str, Any], candidates: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Constructs the payload and calls the LLM for a trading decision.
        """
        payload = {
            "market_overview": market_overview,
            "positions": positions,
            "candidates": candidates
        }
        
        decision = self.llm_client.decide(payload)
        
        # Apply risk rules or further processing here
        return decision