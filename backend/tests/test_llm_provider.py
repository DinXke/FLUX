"""
Tests voor de Claude-aanroep in llm_provider.py (gemockte client, geen echte API-calls).

Gedrag dat vastligt:
  - tool_choice is altijd {"type": "auto"} (geforceerde tool/any geeft 400 op 5.x)
  - tool krijgt strict: true + gesloten schema (additionalProperties: false, required)
  - geen temperature/top_p/top_k en geen thinking-parameter
  - output_config.effort alleen voor modellen die het kennen
  - antwoord zonder tool_use (of refusal/max_tokens) → None + _last_error
"""

import os
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import anthropic  # noqa: E402

import llm_provider  # noqa: E402
from llm_provider import ClaudeProvider, claude_effort_for, get_provider, strict_tool  # noqa: E402
import strategy  # noqa: E402
import strategy_claude  # noqa: E402

from tests.conftest import TEST_START, make_consumption, make_prices, settings  # noqa: E402

TOOL = {
    "name": "submit_battery_plan",
    "description": "test",
    "input_schema": {
        "type": "object",
        "properties": {
            "plan": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "time":   {"type": "string"},
                        "action": {"type": "string", "enum": ["save", "neutral"]},
                    },
                    "required": ["time", "action"],
                },
            },
        },
        "required": ["plan"],
    },
}

PLAN = {"plan": [{"time": "2025-01-14T00:00:00+01:00", "action": "neutral"}]}


def _usage(**kw):
    base = dict(input_tokens=100, output_tokens=50,
                cache_creation_input_tokens=0, cache_read_input_tokens=0)
    base.update(kw)
    return SimpleNamespace(**base)


def _response(content, stop_reason="tool_use", stop_details=None):
    return SimpleNamespace(content=content, stop_reason=stop_reason,
                           stop_details=stop_details, usage=_usage())


def _tool_block(name="submit_battery_plan", inp=None):
    return SimpleNamespace(type="tool_use", name=name, id="toolu_1",
                           input=PLAN if inp is None else inp)


class FakeClient:
    """Neemt de kwargs van messages.create op en geeft vooraf ingestelde antwoorden terug."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        r = self._responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


@pytest.fixture
def fake(monkeypatch):
    holder = {}

    def install(*responses):
        client = FakeClient(responses)
        holder["client"] = client
        monkeypatch.setattr(anthropic, "Anthropic", lambda **kw: client)
        monkeypatch.setattr(llm_provider.time, "sleep", lambda s: None)
        return client

    return install


# ── Request-vorm ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("model", [
    "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1",
    "claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001",
])
def test_request_uses_auto_tool_choice_and_strict_tool(fake, model):
    client = fake(_response([_tool_block()]))
    p = ClaudeProvider("sk-test", model)
    assert p.call_with_tool("sys", "user", TOOL, "submit_battery_plan") == PLAN

    req = client.calls[0]
    assert req["model"] == model
    assert req["tool_choice"]["type"] == "auto"
    tool = req["tools"][0]
    assert tool["strict"] is True
    assert tool["input_schema"]["additionalProperties"] is False
    assert tool["input_schema"]["required"] == ["plan"]
    item = tool["input_schema"]["properties"]["plan"]["items"]
    assert item["additionalProperties"] is False
    assert item["required"] == ["time", "action"]
    # expliciete instructie om de tool aan te roepen
    assert "submit_battery_plan" in req["messages"][0]["content"]


def test_request_has_no_sampling_or_thinking_params(fake):
    client = fake(_response([_tool_block()]))
    ClaudeProvider("sk-test", "claude-opus-5-5").call_with_tool("sys", "u", TOOL, "submit_battery_plan")
    req = client.calls[0]
    for forbidden in ("temperature", "top_p", "top_k", "thinking"):
        assert forbidden not in req


def test_default_max_tokens_leaves_room_for_thinking(fake):
    client = fake(_response([_tool_block()]))
    ClaudeProvider("sk-test", "claude-opus-5-5").call_with_tool("sys", "u", TOOL, "submit_battery_plan")
    assert client.calls[0]["max_tokens"] >= 16000


def test_strict_tool_does_not_mutate_input():
    before = repr(TOOL)
    out = strict_tool(TOOL)
    assert repr(TOOL) == before
    assert "strict" not in TOOL and out["strict"] is True


# ── Effort ───────────────────────────────────────────────────────────────────

def test_effort_sent_for_opus_5_5(fake):
    client = fake(_response([_tool_block()]))
    get_provider("claude", "sk-test", "claude-opus-5-5", effort="high").call_with_tool(
        "sys", "u", TOOL, "submit_battery_plan")
    assert client.calls[0]["output_config"] == {"effort": "high"}


def test_effort_default_is_high():
    assert ClaudeProvider("k", "claude-opus-5-5").build_request(
        "s", "u", TOOL, "submit_battery_plan", 100)["output_config"] == {"effort": "high"}


def test_effort_omitted_for_haiku_4_5(fake):
    client = fake(_response([_tool_block()]))
    ClaudeProvider("sk-test", "claude-haiku-4-5-20251001", effort="high").call_with_tool(
        "sys", "u", TOOL, "submit_battery_plan")
    assert "output_config" not in client.calls[0]


@pytest.mark.parametrize("model,effort,expected", [
    ("claude-opus-5-5",   "max",    "max"),
    ("claude-sonnet-5-5", "xhigh",  "xhigh"),
    ("claude-sonnet-4-6", "xhigh",  "high"),   # 4.6 kent geen xhigh
    ("claude-opus-5-5",   "bogus",  "high"),
    ("claude-opus-5-5",   None,     "high"),
    ("claude-haiku-4-5",  "low",    None),
])
def test_claude_effort_for(model, effort, expected):
    assert claude_effort_for(model, effort) == expected


# ── Antwoordverwerking en foutpaden ─────────────────────────────────────────

def test_tool_use_found_after_thinking_and_text_blocks(fake):
    fake(_response([
        SimpleNamespace(type="thinking", thinking="", signature="x"),
        SimpleNamespace(type="text", text="Ik roep nu de tool aan."),
        _tool_block(),
    ]))
    p = ClaudeProvider("sk-test", "claude-opus-5-5")
    assert p.call_with_tool("sys", "u", TOOL, "submit_battery_plan") == PLAN
    assert p._last_error is None
    assert p._last_usage["input_tokens"] == 100


def test_no_tool_use_returns_none_with_error(fake):
    client = fake(_response([SimpleNamespace(type="text", text="Hier is het plan: ...")],
                            stop_reason="end_turn"))
    p = ClaudeProvider("sk-test", "claude-opus-5-5")
    assert p.call_with_tool("sys", "u", TOOL, "submit_battery_plan") is None
    assert "geen tool_use" in p._last_error
    assert "end_turn" in p._last_error
    assert len(client.calls) == 1  # niet-transiënt: geen herhaling


def test_wrong_tool_name_is_not_accepted(fake):
    fake(_response([_tool_block(name="iets_anders")]))
    p = ClaudeProvider("sk-test", "claude-opus-5-5")
    assert p.call_with_tool("sys", "u", TOOL, "submit_battery_plan") is None


def test_max_tokens_stop_reports_truncation(fake):
    fake(_response([SimpleNamespace(type="thinking", thinking="", signature="x")],
                   stop_reason="max_tokens"))
    p = ClaudeProvider("sk-test", "claude-opus-5-5")
    assert p.call_with_tool("sys", "u", TOOL, "submit_battery_plan", max_tokens=1000) is None
    assert "max_tokens" in p._last_error


def test_refusal_returns_none(fake):
    fake(_response([], stop_reason="refusal",
                   stop_details=SimpleNamespace(type="refusal", category="cyber", explanation="")))
    p = ClaudeProvider("sk-test", "claude-opus-5-5")
    assert p.call_with_tool("sys", "u", TOOL, "submit_battery_plan") is None
    assert "geweigerd" in p._last_error and "cyber" in p._last_error


def test_string_input_is_parsed_as_json(fake):
    fake(_response([_tool_block(inp='{"plan": []}')]))
    p = ClaudeProvider("sk-test", "claude-opus-5-5")
    assert p.call_with_tool("sys", "u", TOOL, "submit_battery_plan") == {"plan": []}


def test_non_object_input_is_rejected(fake):
    fake(_response([_tool_block(inp=["geen", "object"])]))
    p = ClaudeProvider("sk-test", "claude-opus-5-5")
    assert p.call_with_tool("sys", "u", TOOL, "submit_battery_plan") is None
    assert "geen geldig object" in p._last_error


class APIConnectionError(Exception):
    """Naam bevat 'APIConnection' → transiënt volgens de provider."""


def test_transient_error_retried_once(fake):
    client = fake(APIConnectionError("weg"), _response([_tool_block()]))
    p = ClaudeProvider("sk-test", "claude-opus-5-5")
    assert p.call_with_tool("sys", "u", TOOL, "submit_battery_plan") == PLAN
    assert len(client.calls) == 2


def test_bad_request_not_retried(fake):
    client = fake(ValueError("400 tool_choice not supported"))
    p = ClaudeProvider("sk-test", "claude-opus-5-5")
    assert p.call_with_tool("sys", "u", TOOL, "submit_battery_plan") is None
    assert len(client.calls) == 1
    assert "ValueError" in p._last_error


# ── Prijzen en standaarden ───────────────────────────────────────────────────

@pytest.mark.parametrize("model,price", [
    ("claude-opus-5-5",   {"in": 4.00,  "out": 20.00, "cache_write": 5.00,  "cache_read": 0.20}),
    ("claude-sonnet-5-5", {"in": 2.00,  "out": 10.00, "cache_write": 2.50,  "cache_read": 0.20}),
    ("claude-haiku-5-5",  {"in": 0.10,  "out": 0.50,  "cache_write": 0.125, "cache_read": 0.01}),
    ("claude-fable-5-1",  {"in": 10.00, "out": 50.00, "cache_write": 12.50, "cache_read": 0.25}),
    ("claude-opus-4-7",   {"in": 5.00,  "out": 25.00, "cache_write": 6.25,  "cache_read": 0.50}),
])
def test_model_pricing(model, price):
    assert strategy_claude._MODEL_PRICING[model] == price


def test_token_cost_eur_opus_5_5():
    # 1M in + 1M out + 1M cache-write + 1M cache-read = 4 + 20 + 5 + 0,20 USD
    eur = strategy_claude._token_cost_eur("claude-opus-5-5", 1_000_000, 1_000_000, 1_000_000, 1_000_000)
    assert eur == pytest.approx(29.20 * strategy_claude._USD_TO_EUR)


def test_defaults_point_to_current_models():
    d = strategy.DEFAULT_SETTINGS
    assert d["claude_model"] == "claude-opus-5-5"
    assert d["claude_effort"] == "high"
    assert d["auto_claude_model_simple"] == "claude-haiku-5-5"
    assert d["auto_claude_model_complex"] == "claude-opus-5-5"
    for key in ("claude_model", "auto_claude_model_simple", "auto_claude_model_complex"):
        assert d[key] in strategy_claude._MODEL_PRICING


# ── Integratie: build_plan_claude valt terug op rule-based zonder tool_use ──

def test_build_plan_claude_falls_back_when_no_tool_use(fake, monkeypatch, tmp_path):
    # Alle databestanden naar tmp_path, zodat de test niets in backend/ achterlaat
    for name, fn in (("_DATA_DIR", ""), ("_USAGE_FILE", "claude_usage.json"),
                     ("_PRICE_HISTORY_FILE", "_price_history.json"),
                     ("_SOC_HISTORY_FILE", "_soc_history.json"),
                     ("_PLAN_HISTORY_FILE", "_plan_history.json"),
                     ("_PLAN_ACCURACY_FILE", "_plan_accuracy.json")):
        monkeypatch.setattr(strategy_claude, name, str(tmp_path / fn) if fn else str(tmp_path))
    client = fake(_response([SimpleNamespace(type="text", text="geen tool")], stop_reason="end_turn"))
    s = settings(strategy_mode="claude", strategy_ai_provider="claude",
                 claude_api_key="sk-test", claude_model="claude-opus-5-5", claude_effort="high")
    prices = make_prices(flat=0.20, num_hours=24)
    plan = strategy_claude.build_plan_claude(prices, {}, make_consumption(), 50.0, s,
                                             start_dt=TEST_START, num_slots=24)
    assert plan  # rule-based plan in de plaats
    dbg = strategy_claude.get_last_debug()
    assert dbg.get("fallback") is True
    assert "geen tool_use" in (dbg.get("fallback_reason") or "")
    req = client.calls[0]
    assert req["tool_choice"]["type"] == "auto"
    assert req["output_config"] == {"effort": "high"}
    assert req["tools"][0]["strict"] is True
    assert req["tools"][0]["input_schema"]["additionalProperties"] is False
