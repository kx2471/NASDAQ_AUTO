# autotrader/llm/openai_client.py
from openai import OpenAI
import os, json
from typing import Dict, Any
from autotrader.config import config
from autotrader.utils.logging import get_main_logger
from autotrader.utils.validation import validate_json_schema, get_decision_schema

logger = get_main_logger(__name__)

SYSTEM_PROMPT = """당신은 나스닥 하이브리드 트레이딩 전략가입니다. 데이터+뉴스 근거, JSON 스키마 준수, 나스닥 외 배제. 모든 응답은 한국어로 제공해야 합니다."""

def build_prompt(payload: dict) -> str:
    """
    Builds the prompt for the LLM based on the payload.
    """
    # This is a simplified prompt builder. In a real scenario, this would be more complex.
    return json.dumps(payload)

class OpenAIClient:
    """
    Client for interacting with the OpenAI API.
    """
    def __init__(self):
        self.client = OpenAI(api_key=config.OPENAI_API_KEY)
        self.model = config.OPENAI_MODEL

    def decide(self, payload: dict) -> dict:
        """
        Gets a trading decision from the OpenAI API.
        """
        if not config.OPENAI_API_KEY:
            logger.error("OPENAI_API_KEY is not set. Please set it in your .env file.")
            return {}

        prompt = build_prompt(payload)
        try:
            resp = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt}
                ],
                response_format={ "type": "json_object" }
            )
            data = json.loads(resp.choices[0].message.content)
            
            # Validate schema
            if not validate_json_schema(data, get_decision_schema()):
                logger.warning("LLM returned invalid JSON schema. Attempting to re-prompt...")
                # In a real scenario, you might re-prompt with an error message
                return {}

            return data
        except Exception as e:
            logger.error(f"Error calling OpenAI API: {e}")
            return {}