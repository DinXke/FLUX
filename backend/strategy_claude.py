"""
strategy_claude.py – Claude AI-powered battery planning engine.

Alternative to the rule-based strategy.py algorithm.
Uses the Anthropic API to generate an hourly battery plan given:
  - Hourly prices (Frank Energie or ENTSO-E)
  - Solar forecast
  - Historical consumption profile (weekday-aware)
  - Current SoC and battery settings

Returns slots in the same format as strategy.build_plan(), so it can be
used as a drop-in replacement.  Falls back to the rule-based engine on
any error (no API key, network failure, unexpected response, …).
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

log = logging.getLogger("strategy_claude")

WEEKDAY_NL = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"]

# ---------------------------------------------------------------------------
# System prompt (Dutch)
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """Je bent een expert in thuisbatterijbeheer en energieopslag.
Je taak is een uurlijks laadplan opstellen voor een thuisbatterij om de totale energiekosten te minimaliseren.

## Beschikbare acties per uur
- **solar_charge**: Laad de batterij op met zonne-overschot (solar_wh > consumption_wh).
- **grid_charge**: Laad op via het net (goedkoop uur, zinvol als latere uren significant duurder zijn).
- **save**: Houd huidige lading vast — gebruik de batterij NIET, ook niet voor verbruik. Bedoeld om te sparen voor een duurder komend uur.
- **discharge**: Gebruik de batterij om duur netverbruik te vermijden. Batterij levert consumption_wh (max tot min_reserve).
- **neutral**: Laat de firmware automatisch reageren (zonne-overschot → opladen, verbruik → ontladen).

## Beperkingen
- SOC mag nooit onder min_reserve_soc_pct zakken.
- SOC mag nooit boven max_soc_pct stijgen.
- grid_charge laadt max max_charge_kw per uur. Effectieve energietoevoer = charge_kw × rte.
- Winstgevendheid grid_charge: buy_price / rte + depreciation_eur_kwh < toekomstige verwachte prijs.
- Bij discharge: batterij levert min(consumption_wh/1000, bat_kwh - bat_min) kWh aan het huis.
- SAVE = batterij volledig passief. Wordt gebruikt als huidig uur goedkoop is maar binnenkort een veel duurder uur volgt.
- solar_charge is enkel zinvol als net_wh > 0 (zonne-overschot).
- Uren die al voorbij zijn (is_past = true) kunnen elke actie krijgen maar hebben geen invloed meer.

## Doel
Minimaliseer totale energiekosten over de planningsperiode.
Laad goedkoop op (grid_charge) als de spread groot genoeg is om RTE-verlies en afschrijving te rechtvaardigen.
Ontlaad (discharge) tijdens dure uren om netafname te vermijden.
Sla op (save) als het huidige uur relatief goedkoop is maar een duurder uur nadert binnen 16 uur.
Gebruik solar_charge wanneer zonne-energie beschikbaar is en de batterij niet vol is.

## Antwoord
Geef precies één actie per slot terug via de submit_battery_plan tool.
De "time" waarde moet exact overeenkomen met de "time" in de invoer.
Schrijf een korte Nederlandse reden (max 80 tekens).
"""


# ---------------------------------------------------------------------------
# Main function
# ---------------------------------------------------------------------------

def build_plan_claude(
    prices: list[dict],
    solar_wh: dict[str, float],
    consumption_by_hour: list[dict],
    bat_soc_now: float,
    settings: Optional[dict] = None,
    start_dt: Optional[datetime] = None,
    num_slots: int = 48,
) -> list[dict]:
    """
    Build an hourly battery plan using the Claude AI API.
    Returns slots in the same format as strategy.build_plan().
    Falls back to rule-based engine on any error.
    """
    from strategy import (build_plan, load_strategy_settings,
                          SOLAR_CHARGE, GRID_CHARGE, SAVE, DISCHARGE, NEUTRAL)

    s = settings or load_strategy_settings()

    api_key = s.get("claude_api_key", "").strip()
    if not api_key:
        log.warning("strategy_claude: no API key configured — falling back to rule-based")
        return build_plan(prices, solar_wh, consumption_by_hour, bat_soc_now, s,
                          start_dt, num_slots)

    try:
        import anthropic
    except ImportError:
        log.error("strategy_claude: 'anthropic' package not installed — falling back")
        return build_plan(prices, solar_wh, consumption_by_hour, bat_soc_now, s,
                          start_dt, num_slots)

    cap_kwh       = float(s["bat_capacity_kwh"])
    rte           = float(s["rte"])
    depr          = float(s["depreciation_eur_kwh"])
    min_soc_f     = float(s["min_reserve_soc"]) / 100.0
    max_soc_f     = float(s["max_soc"]) / 100.0
    max_charge_kw = float(s["max_charge_kw"])
    markup        = float(s.get("grid_markup_eur_kwh", 0.12))
    tz_name       = s.get("timezone", "Europe/Brussels")
    tz            = ZoneInfo(tz_name)
    model         = s.get("claude_model", "claude-haiku-4-5-20251001")

    bat_min = min_soc_f * cap_kwh
    bat_max = max_soc_f * cap_kwh

    # ── Price lookup ──────────────────────────────────────────────────────
    price_by_slot: dict[str, list] = {}
    for p in prices:
        try:
            dt_raw = datetime.fromisoformat(p["from"])
            dt_loc = (dt_raw.replace(tzinfo=tz) if dt_raw.tzinfo is None
                      else dt_raw.astimezone(tz))
            key = dt_loc.replace(minute=0, second=0, microsecond=0).isoformat()
            price_by_slot.setdefault(key, []).append(float(p["marketPrice"]))
        except Exception:
            pass
    price_slots: dict[str, float] = {
        k: sum(v) / len(v) for k, v in price_by_slot.items()
    }

    # ── Solar lookup ──────────────────────────────────────────────────────
    solar_by_slot: dict[str, float] = {}
    for k, wh in (solar_wh or {}).items():
        try:
            dt_str = k if "T" in k else k.replace(" ", "T")
            dt = datetime.fromisoformat(dt_str)
            dt = dt.replace(tzinfo=tz) if dt.tzinfo is None else dt.astimezone(tz)
            key = dt.replace(minute=0, second=0, microsecond=0).isoformat()
            solar_by_slot[key] = solar_by_slot.get(key, 0.0) + float(wh)
        except Exception:
            pass

    # ── Consumption lookup (weekday-aware) ────────────────────────────────
    cons_by_wd_hour: dict[tuple, float] = {}
    cons_by_hour:    dict[int, float]   = {}
    for x in (consumption_by_hour or []):
        h = int(x["hour"]); v = float(x["avg_wh"]); wd = x.get("weekday")
        if wd is not None:
            cons_by_wd_hour[(int(wd), h)] = v
        else:
            cons_by_hour[h] = v
    has_wd = bool(cons_by_wd_hour)

    def _cons(wd: int, h: int) -> float:
        if has_wd:
            return cons_by_wd_hour.get((wd, h), cons_by_hour.get(h, 300.0))
        return cons_by_hour.get(h, 300.0)

    # ── Hourly window ─────────────────────────────────────────────────────
    real_now = datetime.now(tz).replace(minute=0, second=0, microsecond=0)
    if start_dt is not None:
        now_local = start_dt.astimezone(tz).replace(minute=0, second=0, microsecond=0)
    else:
        now_local = real_now.replace(hour=0, minute=0, second=0, microsecond=0)
    all_slots = [now_local + timedelta(hours=i) for i in range(num_slots)]

    # Price statistics
    known_prices = [
        price_slots[sl.isoformat()] + markup
        for sl in all_slots
        if sl.isoformat() in price_slots
    ]
    if known_prices:
        sp = sorted(known_prices); n = len(sp)
        p25    = sp[int(n * 0.25)]
        median = sp[n // 2]
        p75    = sp[int(n * 0.75)]
        p_min  = sp[0]
        p_max  = sp[-1]
    else:
        p25 = median = p75 = p_min = p_max = 0.10

    # ── Build input slots for Claude ──────────────────────────────────────
    slots_input = []
    _bat = bat_soc_now / 100.0 * cap_kwh  # running SOC for display only

    for slot_dt in all_slots:
        key      = slot_dt.isoformat()
        raw      = price_slots.get(key)
        buy      = (raw + markup) if raw is not None else None
        solar    = round(solar_by_slot.get(key, 0.0))
        cons     = round(_cons(slot_dt.weekday(), slot_dt.hour))
        net      = solar - cons

        slots_input.append({
            "time":               key,
            "weekday":            WEEKDAY_NL[slot_dt.weekday()],
            "hour":               slot_dt.hour,
            "buy_price_eur_kwh":  round(buy, 4) if buy is not None else None,
            "solar_wh":           solar,
            "consumption_wh":     cons,
            "net_wh":             net,
            "soc_start_pct":      round((_bat / cap_kwh) * 100, 1),
            "is_past":            slot_dt < real_now,
        })

    # ── Build Claude request payload ──────────────────────────────────────
    payload = {
        "battery": {
            "capacity_kwh":         cap_kwh,
            "current_soc_pct":      round(bat_soc_now, 1),
            "min_reserve_soc_pct":  float(s["min_reserve_soc"]),
            "max_soc_pct":          float(s["max_soc"]),
            "max_charge_kw":        max_charge_kw,
            "rte":                  rte,
            "depreciation_eur_kwh": depr,
        },
        "price_stats": {
            "p25_eur_kwh":    round(p25,    4),
            "median_eur_kwh": round(median, 4),
            "p75_eur_kwh":    round(p75,    4),
            "min_eur_kwh":    round(p_min,  4),
            "max_eur_kwh":    round(p_max,  4),
        },
        "slots": slots_input,
    }

    tool_def = {
        "name": "submit_battery_plan",
        "description": "Geef het volledige uurlijks batterijplan terug.",
        "input_schema": {
            "type": "object",
            "properties": {
                "plan": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "time":   {
                                "type":        "string",
                                "description": "ISO-tijdstempel, exact gelijk aan invoer 'time'",
                            },
                            "action": {
                                "type": "string",
                                "enum": [
                                    "solar_charge", "grid_charge",
                                    "save", "discharge", "neutral",
                                ],
                            },
                            "reason": {
                                "type":        "string",
                                "description": "Korte Nederlandse uitleg (max 80 tekens)",
                            },
                        },
                        "required": ["time", "action", "reason"],
                    },
                },
            },
            "required": ["plan"],
        },
    }

    log.info("strategy_claude: calling model=%s  slots=%d", model, len(slots_input))

    try:
        client   = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=model,
            max_tokens=8192,
            system=_SYSTEM_PROMPT,
            tools=[tool_def],
            tool_choice={"type": "any"},
            messages=[{
                "role":    "user",
                "content": (
                    "Hier zijn de batterijparameters en de geplande uren. "
                    "Stel het optimale laadplan op:\n\n"
                    f"```json\n{json.dumps(payload, ensure_ascii=False, indent=2)}\n```"
                ),
            }],
        )
    except Exception as exc:
        log.error("strategy_claude: API call failed: %s — falling back to rule-based", exc)
        return build_plan(prices, solar_wh, consumption_by_hour, bat_soc_now, s,
                          start_dt, num_slots)

    # ── Parse tool-use response ───────────────────────────────────────────
    VALID_ACTIONS = {SOLAR_CHARGE, GRID_CHARGE, SAVE, DISCHARGE, NEUTRAL}
    plan_actions: dict[str, tuple[str, str]] = {}

    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "submit_battery_plan":
            for item in block.input.get("plan", []):
                t = str(item.get("time", "")).strip()
                a = str(item.get("action", "neutral"))
                r = str(item.get("reason", ""))
                if a not in VALID_ACTIONS:
                    a = NEUTRAL
                plan_actions[t] = (a, r)
            break

    if not plan_actions:
        log.warning("strategy_claude: no valid tool_use in response — falling back to rule-based")
        return build_plan(prices, solar_wh, consumption_by_hour, bat_soc_now, s,
                          start_dt, num_slots)

    log.info("strategy_claude: received %d actions from Claude (%s)",
             len(plan_actions), model)

    # ── Reconstruct slot list with SOC simulation ─────────────────────────
    bat_kwh      = bat_soc_now / 100.0 * cap_kwh
    result_slots = []

    for slot_dt in all_slots:
        key    = slot_dt.isoformat()
        raw    = price_slots.get(key)
        buy    = (raw + markup) if raw is not None else None
        solar  = solar_by_slot.get(key, 0.0)
        cons   = _cons(slot_dt.weekday(), slot_dt.hour)
        net    = solar - cons

        action, reason = plan_actions.get(key, (NEUTRAL, "Geen actie van Claude"))
        soc_start = (bat_kwh / cap_kwh) * 100.0

        charge_kwh    = 0.0
        discharge_kwh = 0.0

        if action == GRID_CHARGE:
            headroom       = bat_max - bat_kwh
            charge_draw_kw = min(max_charge_kw, headroom / rte if rte > 0 else 0)
            if charge_draw_kw > 0.05:
                energy_in   = charge_draw_kw * rte
                bat_kwh     = min(bat_max, bat_kwh + energy_in)
                charge_kwh  = charge_draw_kw

        elif action == SOLAR_CHARGE:
            if net > 0:
                surplus_kwh = (net / 1000.0) * rte
                headroom    = bat_max - bat_kwh
                store       = min(surplus_kwh, headroom)
                if store > 0:
                    bat_kwh    += store
                    charge_kwh  = net / 1000.0

        elif action == DISCHARGE:
            avail = bat_kwh - bat_min
            use   = min(cons / 1000.0, avail)
            if use > 0.05:
                bat_kwh       -= use
                discharge_kwh  = use

        # SAVE and NEUTRAL: no bat_kwh change in simulation
        # (SAVE = hold; NEUTRAL = firmware manages it, we can't predict)

        soc_end = (bat_kwh / cap_kwh) * 100.0

        result_slots.append({
            "time":           key,
            "hour":           slot_dt.hour,
            "price_eur_kwh":  round(buy, 4)  if buy is not None else None,
            "price_raw":      round(raw, 4)  if raw is not None else None,
            "solar_wh":       round(solar, 0),
            "consumption_wh": round(cons, 0),
            "net_wh":         round(net, 0),
            "action":         action,
            "reason":         reason,
            "charge_kwh":     round(charge_kwh, 3),
            "discharge_kwh":  round(discharge_kwh, 3),
            "soc_start":      round(soc_start, 1),
            "soc_end":        round(soc_end, 1),
            "is_peak":        False,   # Claude reasons about peak implicitly
            "is_past":        slot_dt < real_now,
        })

    return result_slots
