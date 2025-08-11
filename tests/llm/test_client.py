# tests/llm/test_client.py
import pytest
from autotrader.llm.client import OpenAIClient
from autotrader.config import config

def test_openai_client_initialization(mocker):
    """
    Tests that the OpenAIClient initializes correctly with the API key.
    """
    mocker.patch.object(config, 'OPENAI_API_KEY', 'test_key')
    client = OpenAIClient()
    assert client.api_key == 'test_key'

def test_get_completion_no_api_key(mocker):
    """
    Tests get_completion when no API key is set.
    """
    mocker.patch.object(config, 'OPENAI_API_KEY', None)
    client = OpenAIClient()
    result = client.get_completion("test prompt")
    assert result == ""

def test_get_completion_success(mocker):
    """
    Tests successful get_completion call.
    """
    mocker.patch.object(config, 'OPENAI_API_KEY', 'test_key')
    mock_create = mocker.patch('openai.chat.completions.create')
    mock_create.return_value.choices[0].message.content = "LLM Response"

    client = OpenAIClient()
    result = client.get_completion("test prompt")
    assert result == "LLM Response"
    mock_create.assert_called_once()

def test_get_trading_decision_success(mocker):
    """
    Tests successful get_trading_decision call with valid JSON.
    """
    mocker.patch.object(config, 'OPENAI_API_KEY', 'test_key')
    mock_get_completion = mocker.patch.object(OpenAIClient, 'get_completion')
    mock_get_completion.return_value = '{"symbol": "TEST", "decision": "BUY", "confidence": 0.9, "reasoning": "Good", "price_target": 100.0, "stop_loss": 90.0}'

    client = OpenAIClient()
    decision = client.get_trading_decision("test context")
    assert decision['symbol'] == "TEST"
    assert decision['decision'] == "BUY"

def test_get_trading_decision_invalid_json(mocker):
    """
    Tests get_trading_decision with invalid JSON response.
    """
    mocker.patch.object(config, 'OPENAI_API_KEY', 'test_key')
    mock_get_completion = mocker.patch.object(OpenAIClient, 'get_completion')
    mock_get_completion.return_value = 'Invalid JSON'

    client = OpenAIClient()
    decision = client.get_trading_decision("test context")
    assert decision == {}
