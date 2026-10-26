"""
llm_provider.py – Unified LLM provider abstraction.

Supports both Anthropic Claude and OpenAI APIs with a common interface.
Handles API key management, model selection, and response parsing for tool use.
"""

import json
import logging
import time
from typing import Optional

log = logging.getLogger("llm_provider")

# Seconds to wait between retry attempts for transient errors
_RETRY_DELAY_S = 3.0
# Hard timeout (seconds) for a single Claude API call.
# Ruimer dan voorheen (120 s): de 5.x-modellen denken altijd (adaptief) en effort
# "high" op 48 slots kan langer duren.
_CLAUDE_TIMEOUT_S = 240.0


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


_EFFORT_LEVELS = ("low", "medium", "high", "xhigh", "max")

# Modellen die output_config.effort NIET kennen (geven een 400). Prefix-match.
_NO_EFFORT_PREFIXES = (
    "claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-1", "claude-opus-4-0",
    "claude-sonnet-4-0", "claude-opus-4-2", "claude-sonnet-4-2", "claude-3",
)
# Modellen zonder "xhigh" (kwam pas met Opus 4.7) → terugvallen op "high".
_NO_XHIGH_PREFIXES = ("claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-5")


def claude_effort_for(model: str, effort: Optional[str]) -> Optional[str]:
    """Effectieve effort voor dit model, of None als het model geen effort kent."""
    m = (model or "").lower()
    if any(m.startswith(p) for p in _NO_EFFORT_PREFIXES):
        return None
    e = (effort or "high").lower()
    if e not in _EFFORT_LEVELS:
        e = "high"
    if e == "xhigh" and any(m.startswith(p) for p in _NO_XHIGH_PREFIXES):
        e = "high"
    return e


def strict_tool(tool_def: dict) -> dict:
    """Kopie van tool_def met strict: true en additionalProperties: false op elk object.

    Strict tool use vereist een gesloten schema; zo hoeft de aanroeper dat niet zelf
    overal te zetten. Bestaande 'required'-lijsten blijven ongemoeid.
    """
    def _close(node):
        if isinstance(node, dict):
            node = {k: _close(v) for k, v in node.items()}
            if node.get("type") == "object":
                node.setdefault("additionalProperties", False)
                node.setdefault("required", list((node.get("properties") or {}).keys()))
            return node
        if isinstance(node, list):
            return [_close(v) for v in node]
        return node

    out = dict(tool_def)
    out["input_schema"] = _close(tool_def.get("input_schema") or {"type": "object", "properties": {}})
    out["strict"] = True
    return out


class ClaudeProvider(LLMProvider):
    """Anthropic Claude provider.

    Eén codepad voor alle Claude-modellen: tool_choice "auto" + strict tool + expliciete
    promptinstructie. Geforceerde tool_choice ("tool"/"any") geeft een 400 op
    claude-opus-5-5, claude-sonnet-5-5 en claude-fable-5-1. Geen temperature/top_p/top_k
    (400 sinds 21-10-2026) en geen thinking-parameter (5.x weigert disabled/budget_tokens;
    weglaten = adaptief op de 5.x-modellen). Diepgang via output_config.effort.
    """

    def __init__(self, api_key: str, model: str, effort: Optional[str] = "high"):
        super().__init__(api_key, model)
        self.effort = effort
        self._last_error = None
        self._last_stop_reason = None
        self._last_usage = {}

    def build_request(self, system_prompt: str, user_message: str, tool_def: dict,
                      tool_name: str, max_tokens: int) -> dict:
        """Bouw de kwargs voor client.messages.create (apart zodat tests ze kunnen nakijken)."""
        instruction = (
            f"\n\nRoep de tool `{tool_name}` precies één keer aan met het volledige resultaat. "
            "Geef het antwoord niet als gewone tekst."
        )
        req = {
            "model": self.model,
            "max_tokens": max_tokens,
            "system": [{
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }],
            "tools": [strict_tool(tool_def)],
            "tool_choice": {"type": "auto", "disable_parallel_tool_use": True},
            "messages": [{
                "role": "user",
                "content": user_message + instruction,
            }],
        }
        effort = claude_effort_for(self.model, self.effort)
        if effort:
            req["output_config"] = {"effort": effort}
        return req

    def call_with_tool(self, system_prompt: str, user_message: str, tool_def: dict,
                      tool_name: str, max_tokens: int = 16000) -> Optional[dict]:
        try:
            import anthropic
        except ImportError:
            log.error("ClaudeProvider: 'anthropic' package not installed")
            self._last_error = "anthropic-pakket niet geïnstalleerd"
            return None

        client = anthropic.Anthropic(api_key=self.api_key, timeout=_CLAUDE_TIMEOUT_S)
        req = self.build_request(system_prompt, user_message, tool_def, tool_name, max_tokens)
        last_exc = None

        for attempt in range(2):  # try once, retry once on transient error
            try:
                response = client.messages.create(**req)
                stop = getattr(response, "stop_reason", None)
                self._last_stop_reason = stop
                u = getattr(response, "usage", None)
                self._last_usage = {
                    "input_tokens":                  getattr(u, "input_tokens",                  0) or 0,
                    "output_tokens":                 getattr(u, "output_tokens",                 0) or 0,
                    "cache_creation_input_tokens":   getattr(u, "cache_creation_input_tokens",   0) or 0,
                    "cache_read_input_tokens":       getattr(u, "cache_read_input_tokens",       0) or 0,
                }

                if stop == "refusal":
                    det = getattr(response, "stop_details", None)
                    cat = getattr(det, "category", None) if det else None
                    log.error("ClaudeProvider: request geweigerd (category=%s)", cat)
                    self._last_error = f"verzoek geweigerd door model (categorie={cat})"
                    return None

                for block in (getattr(response, "content", None) or []):
                    if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == tool_name:
                        data = block.input
                        if isinstance(data, str):  # zou niet mogen, maar nooit string-matchen
                            try:
                                data = json.loads(data)
                            except (json.JSONDecodeError, ValueError):
                                data = None
                        if not isinstance(data, dict):
                            log.error("ClaudeProvider: tool_use-input is geen object (%s)", type(block.input).__name__)
                            self._last_error = "tool_use-input is geen geldig object"
                            return None
                        self._last_error = None
                        return data

                log.error(
                    "ClaudeProvider: no tool_use block in response "
                    "(attempt=%d stop_reason=%s content_types=%s)",
                    attempt + 1,
                    stop,
                    [getattr(b, "type", "?") for b in (getattr(response, "content", None) or [])],
                )
                if stop == "max_tokens":
                    self._last_error = f"antwoord afgekapt op max_tokens={max_tokens} zonder tool_use"
                else:
                    self._last_error = f"geen tool_use in antwoord (stop={stop})"
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


def get_provider(provider_name: str, api_key: str, model: str,
                 effort: Optional[str] = "high") -> Optional[LLMProvider]:
    """
    Factory function to get the right provider.

    Args:
        provider_name: "claude" or "openai"
        api_key: API key for the provider
        model: Model ID/name
        effort: Claude output_config.effort (genegeerd door OpenAI en door modellen zonder effort)

    Returns:
        LLMProvider instance, or None if provider unknown
    """
    provider_name = provider_name.lower()
    if provider_name == "claude":
        return ClaudeProvider(api_key, model, effort=effort)
    elif provider_name == "openai":
        return OpenAIProvider(api_key, model)
    else:
        log.error("get_provider: unknown provider '%s'", provider_name)
        return None
