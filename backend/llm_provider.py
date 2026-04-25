"""
llm_provider.py – Unified LLM provider abstraction.

Supports both Anthropic Claude and OpenAI APIs with a common interface.
Handles API key management, model selection, and response parsing for tool use.
"""

import logging
from typing import Optional

log = logging.getLogger("llm_provider")


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

        try:
            client = anthropic.Anthropic(api_key=self.api_key)
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
                    return block.input
            return None

        except Exception as exc:
            log.error("ClaudeProvider: API call failed: %s", exc)
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
                system=system_prompt,
                tools=[{
                    "type": "function",
                    "function": openai_tool_def,
                }],
                tool_choice={
                    "type": "function",
                    "function": {"name": tool_name},
                },
                messages=[{
                    "role": "user",
                    "content": user_message,
                }],
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
