"""
llm_provider.py – Unified LLM provider abstraction.

Supports both Anthropic Claude and OpenAI APIs with a common interface.
Handles API key management, model selection, and response parsing for tool use.
"""

import logging
import time
from typing import Optional

log = logging.getLogger("llm_provider")

# Seconds to wait between retry attempts for transient errors
_RETRY_DELAY_S = 3.0
# Hard timeout (seconds) for a single Claude API call
_CLAUDE_TIMEOUT_S = 120.0


class LLMProvider:
    """Abstract base for LLM providers."""

    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model

    def call_with_tool(self, system_prompt: str, user_message: str, tool_def: dict,
                      tool_name: str, max_tokens: int = 8192) -> Optional[dict]:
        """
        Call the LLM with tool use.

        Args:
            system_prompt: System message
            user_message: User message
            tool_def: Tool definition (JSON schema)
            tool_name: Expected tool name in response
            max_tokens: Max tokens to generate

        Returns:
            dict from tool.input, or None on error
        """
        raise NotImplementedError

    def is_configured(self) -> bool:
        """Check if API key is configured."""
        return bool(self.api_key and self.api_key.strip())


class ClaudeProvider(LLMProvider):
    """Anthropic Claude provider."""

    def call_with_tool(self, system_prompt: str, user_message: str, tool_def: dict,
                      tool_name: str, max_tokens: int = 8192) -> Optional[dict]:
        try:
            import anthropic
        except ImportError:
            log.error("ClaudeProvider: 'anthropic' package not installed")
            return None

        client = anthropic.Anthropic(api_key=self.api_key, timeout=_CLAUDE_TIMEOUT_S)
        last_exc = None

        for attempt in range(2):  # try once, retry once on transient error
            try:
                response = client.messages.create(
                    model=self.model,
                    max_tokens=max_tokens,
                    system=[{
                        "type": "text",
                        "text": system_prompt,
                        "cache_control": {"type": "ephemeral"},
                    }],
                    tools=[tool_def],
                    tool_choice={"type": "tool", "name": tool_name},
                    messages=[{
                        "role": "user",
                        "content": user_message,
                    }],
                )

                for block in response.content:
                    if getattr(block, "type", None) == "tool_use" and block.name == tool_name:
                        self._last_error = None
                        self._last_stop_reason = getattr(response, "stop_reason", None)
                        u = response.usage
                        self._last_usage = {
                            "input_tokens":                  getattr(u, "input_tokens",                  0) or 0,
                            "output_tokens":                 getattr(u, "output_tokens",                 0) or 0,
                            "cache_creation_input_tokens":   getattr(u, "cache_creation_input_tokens",   0) or 0,
                            "cache_read_input_tokens":       getattr(u, "cache_read_input_tokens",       0) or 0,
                        }
                        return block.input

                log.error(
                    "ClaudeProvider: no tool_use block in response "
                    "(attempt=%d stop_reason=%s content_types=%s)",
                    attempt + 1,
                    getattr(response, "stop_reason", "?"),
                    [getattr(b, "type", "?") for b in response.content],
                )
                self._last_error = f"geen tool_use in antwoord (stop={getattr(response, 'stop_reason', '?')})"
                return None  # non-transient: no retry

            except Exception as exc:
                exc_type = type(exc).__name__
                last_exc = exc
                self._last_error = f"{exc_type}: {exc}"
                log.error("ClaudeProvider: API call failed attempt %d [%s]: %s",
                          attempt + 1, exc_type, exc)
                # Only retry on transient errors (connection/rate-limit issues)
                _transient = ("RateLimit", "APIConnection", "Timeout", "ServiceUnavailable")
                if attempt == 0 and any(t in exc_type for t in _transient):
                    log.info("ClaudeProvider: transient error, retrying in %.0fs...", _RETRY_DELAY_S)
                    time.sleep(_RETRY_DELAY_S)
                    continue
                break

        return None


class OpenAIProvider(LLMProvider):
    """OpenAI provider (GPT-4o, o1, o3)."""

    def call_with_tool(self, system_prompt: str, user_message: str, tool_def: dict,
                      tool_name: str, max_tokens: int = 8192) -> Optional[dict]:
        try:
            import json
            from openai import OpenAI
        except ImportError:
            log.error("OpenAIProvider: 'openai' package not installed")
            return None

        try:
            client = OpenAI(api_key=self.api_key)

            # Convert Claude's input_schema to OpenAI's function format
            openai_tool_def = self._convert_tool_def(tool_def)

            response = client.chat.completions.create(
                model=self.model,
                max_tokens=max_tokens,
                tools=[{
                    "type": "function",
                    "function": openai_tool_def,
                }],
                tool_choice={
                    "type": "function",
                    "function": {"name": tool_name},
                },
                messages=[
                    {
                        "role": "system",
                        "content": system_prompt,
                    },
                    {
                        "role": "user",
                        "content": user_message,
                    },
                ],
            )

            for choice in response.choices:
                if choice.message.tool_calls:
                    for tool_call in choice.message.tool_calls:
                        if tool_call.function.name == tool_name:
                            try:
                                return json.loads(tool_call.function.arguments)
                            except (json.JSONDecodeError, ValueError) as e:
                                log.error("OpenAIProvider: failed to parse tool args: %s", e)
                                return None
            return None

        except Exception as exc:
            log.error("OpenAIProvider: API call failed: %s", exc)
            return None

    def _convert_tool_def(self, claude_tool: dict) -> dict:
        """Convert Claude's tool definition to OpenAI's function format."""
        return {
            "name": claude_tool.get("name", "unknown"),
            "description": claude_tool.get("description", ""),
            "parameters": claude_tool.get("input_schema", {
                "type": "object",
                "properties": {},
                "required": [],
            }),
        }


def get_provider(provider_name: str, api_key: str, model: str) -> Optional[LLMProvider]:
    """
    Factory function to get the right provider.

    Args:
        provider_name: "claude" or "openai"
        api_key: API key for the provider
        model: Model ID/name

    Returns:
        LLMProvider instance, or None if provider unknown
    """
    provider_name = provider_name.lower()
    if provider_name == "claude":
        return ClaudeProvider(api_key, model)
    elif provider_name == "openai":
        return OpenAIProvider(api_key, model)
    else:
        log.error("get_provider: unknown provider '%s'", provider_name)
        return None
