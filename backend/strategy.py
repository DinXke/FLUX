"""
strategy.py – Battery charging / saving / discharging strategy algorithm.

Given:
  - Hourly energy prices for today + tomorrow (€/kWh)
  - Hourly solar forecast (Wh)
  - Hourly expected consumption (Wh, from InfluxDB history or manual)
  - Battery parameters (capacity, RTE, depreciation, current SOC, min reserve)

Returns a 48-slot timeline with a recommended action for each hour:

  SOLAR_CHARGE  – solar production expected > consumption; charge from solar
  GRID_CHARGE   – buy cheap grid electricity to charge battery
  SAVE          – battery has charge, hold it for upcoming expensive period
  DISCHARGE     – use battery, avoid expensive grid draw
  NEUTRAL       – do nothing special

Each slot also contains expected SOC at start/end of that hour.
"""

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

log = logging.getLogger("strategy")

# ---------------------------------------------------------------------------
# Settings file
# ---------------------------------------------------------------------------

_DATA_DIR = os.environ.get("MARSTEK_DATA_DIR", os.path.dirname(os.path.abspath(__file__)))
STRATEGY_SETTINGS_FILE = os.path.join(_DATA_DIR, "strategy_settings.json")

DEFAULT_SETTINGS = {
    "bat_capacity_kwh":     10.0,   # total usable battery capacity
    "rte":                  0.85,   # round-trip efficiency
    "depreciation_eur_kwh": 0.06,   # cost per kWh cycled through battery
    "min_reserve_soc":      10,     # % always kept as reserve
    "max_soc":              95,     # % max charge target
    "max_charge_kw":        3.0,    # max grid charge rate
    "sell_back":            False,  # can we sell excess to grid?
    "timezone":             "Europe/Brussels",
    # Manual peak hours override (list of hour ints 0-23).
    # Empty = derive from consumption history.
    "manual_peak_hours":    [],
    # How many consecutive hours of history to use for consumption baseline
    "history_days":         21,
    # Tax / distribution markup on top of market price (€/kWh)
    "grid_markup_eur_kwh":  0.12,
    # Price source for strategy: "entsoe" or "frank"
    # When "frank": uses Frank Energie all-in prices (incl. taxes/markup).
    #   Set grid_markup_eur_kwh to only network/distribution fee (~0.05–0.07).
    # When "entsoe": uses ENTSO-E wholesale prices + grid_markup_eur_kwh.
    "price_source":         "entsoe",
    # Consumption profile source: "auto" | "prophet" | "local_influx" | "external_influx" | "ha_history"
    # "auto": tries prophet → external_influx → local_influx → ha_history (fallback chain).
    # "prophet": uses ML forecast from 32d InfluxDB history (when sufficient data available).
    "consumption_source":   "auto",
    # Standby/parasitic consumption in Watt (always-on appliances, fridges, …).
    # 0 = auto-detect from 02:00–06:00 historical average.
    # Used to filter standby-only hours out of peak detection.
    "standby_w":            0,
    # Minimum price premium for "save for better hour" to trigger.
    # 0.30 = best upcoming price must be ≥30% above current price (AND above p75).
    # Lower = more aggressive saving; higher = only save for very large spreads.
    "save_price_factor":    0.30,
    # Minimum net spread (€/kWh) between effective charge cost and best future
    # price to trigger grid charging.  5ct = charge from grid when you gain ≥5ct
    # per stored kWh after efficiency + depreciation losses.
    "min_charge_spread_eur_kwh": 0.05,
    # PV power limiter (e.g. SMA Sunny Boy via Home Assistant number entity)
    "pv_limiter_enabled":        False,
    "pv_limiter_entity":         "",     # HA entity_id for number.set_value mode
    "pv_limiter_min_w":          50,     # limit when price is negative/below threshold (W); 50W floor prevents accidental 0W
    "pv_limiter_max_w":          4000,   # restore to this value (W) when price OK
    "pv_limiter_threshold_ct":   0.0,    # trigger below this price (ct/kWh); 0 = only negative
    "pv_limiter_margin_w":       200,    # extra buffer above house+bat load to avoid oscillation (legacy)
    "pv_limiter_manual_override": False, # True = ignore price logic, use manual_w
    "pv_limiter_manual_w":       2000,   # manual override target (W)
    # Custom HA service mode (e.g. SMA Devices Plus)
    "pv_limiter_use_service":    False,  # True = use custom service instead of number.set_value
    "pv_limiter_service":        "",     # e.g. "pysmaplus.set_value"
    "pv_limiter_service_param_key":   "entity_id",  # data key alongside "value": "entity_id" or "parameter"
    "pv_limiter_service_param":  "",     # value for that key, e.g. "sensor.sb4_0_active_power_limitation"
    # Direct Modbus TCP/IP mode (bypasses HA; communicates directly with inverter)
    "pv_limiter_use_modbus":         False,
    "pv_limiter_modbus_host":        "",    # IP address of the inverter (e.g. SMA Sunny Boy)
    "pv_limiter_modbus_port":        502,
    "pv_limiter_modbus_unit_id":     3,    # SMA default = 3
    "pv_limiter_modbus_register":    42062, # SMA Sunny Boy W-limiet: 42062 (1-based); WMaxLimPct (%): 40236
    "pv_limiter_modbus_value_mode":  "W",  # "W" = absolute watts, "pct" = 0–100 %
    "pv_limiter_modbus_dtype":       "U32", # "U16" = FC16 1-register (16-bit), "U32" = FC16 2-registers (32-bit)
    # SMA Modbus reader — uitlezen van omvormerdata (Fase 1 SCH-737)
    "sma_reader_enabled":    False,
    "sma_reader_host":       "",    # IP-adres omvormer (kan zelfde zijn als pv_limiter_modbus_host)
    "sma_reader_port":       502,
    "sma_reader_unit_id":    3,     # SMA default slave ID = 3
    "sma_reader_use_udp":    False, # SMA reageert niet op Modbus UDP; altijd TCP gebruiken
    "sma_reader_interval_s": 10,    # pollinterval in seconden
    "sma_reader_max_w":      4000,  # nominaal max vermogen (W) — voor strategie-logica
    "sma_reader_registers":  None,  # None = gebruik default registermap uit sma_modbus.py
    # Strategy engine: "rule_based" (default), "claude", or "auto"
    # "auto": picks rule_based on flat days, Claude on complex/negative-price days
    "strategy_mode":        "rule_based",
    # AI provider selection for strategy: "claude", "openai", or "auto"
    # "auto": picks rule_based on flat days, Claude/OpenAI on complex/negative-price days
    "strategy_ai_provider":  "claude",
    # Anthropic API key (used when strategy_ai_provider = "claude" or "auto")
    "claude_api_key":       "",
    # Claude model to use for planning (Sonnet = recommended; Haiku = cheapest/fastest)
    "claude_model":         "claude-sonnet-4-6",
    # OpenAI API key (used when strategy_ai_provider = "openai" or "auto")
    "openai_api_key":       "",
    # OpenAI model to use for planning (gpt-4o = recommended; gpt-4o-mini = cheaper)
    # Available: gpt-4o, gpt-4o-mini, o1, o3
    "openai_model":         "gpt-4o",
    # Auto-engine selection thresholds (only used when strategy_mode = "auto")
    # p75−p25 < auto_complexity_threshold AND no negatives → rule_based (flat day)
    # p75−p25 ≥ auto_complexity_high_threshold OR negatives → Claude Sonnet/gpt-4o (complex)
    # in between → Claude Haiku/gpt-4o-mini (average day)
    "auto_complexity_threshold":      0.03,
    "auto_complexity_high_threshold": 0.06,
    "auto_claude_model_simple":       "claude-haiku-4-5-20251001",
    "auto_claude_model_complex":      "claude-sonnet-4-6",
    "auto_openai_model_simple":       "gpt-4o-mini",
    "auto_openai_model_complex":      "gpt-4o",
    # Capaciteitstarief-bescherming (België: maandelijkse piekkwartier)
    # Als actief_net + geplande_charge > cap_tariff_max_grid_w: proportioneel afknijpen/blokkeren.
    "cap_tariff_enabled":    False,
    "cap_tariff_max_grid_w": 8000,   # W — max toegestaan netsaldo (import) incl. huis + EV + laden
    # Rolling netsaldo-plafond (PV-first prioriteit, onafhankelijke lus)
    # Bijsturings-volgorde: 1) PV-limiter verlagen, 2) batterijlaadvermogen verlagen
    "rolling_cap_enabled":         False,
    "rolling_cap_max_net_w":       8000,  # W — max zwevend gemiddeld netsaldo (import)
    "rolling_cap_net_window_m":    10,    # min — venster voor netsaldo zwevend gemiddelde
    "rolling_cap_device_window_m": 5,     # min — venster voor PV/batterij zwevend gemiddelde
    # Preventieve ontlading vóór negatieve prijsvensters
    # Ontlaad de batterij in de aanloop naar negatieve prijzen zodat er meer
    # ruimte is voor gratis/betaald laden tijdens het negatieve prijsvenster.
    "neg_price_discharge_enabled": True,
    "neg_price_lookahead_h":       4,    # uren vooruitkijken voor negatieve prijs
    "neg_price_threshold_ct":      0.0,  # ct/kWh: prijs < dit = negatief (0 = alleen echt negatief)
    # Telegram-notificaties via CommunicationAgent
    "telegram_enabled":            False,
    "telegram_chat_id":            "",
    "telegram_comm_url":           "http://localhost:3001",
    "telegram_events": {
        "plan_ready":             True,
        "grid_charge_opportunity": True,
        "esphome_failed":         True,
        "daily_summary":          True,
        "sma_offline":            True,
        "sma_error":              True,
        "sma_day_summary":        True,
        "anomaly_stale_sensors":  True,
        "anomaly_unusual_peaks":  True,
        "anomaly_inverter_faults": True,
    },
    "telegram_grid_price_threshold": 0.10,  # €/kWh: grid_charge_opportunity als prijs < dit
    "telegram_grid_soc_threshold":   80,    # %: grid_charge_opportunity als SoC < dit
    # Discord-notificaties via webhook
    "discord_enabled":               False,
    "discord_webhook_url":           "",
    "discord_events": {
        "plan_ready":              True,
        "grid_charge_opportunity": True,
        "esphome_failed":          True,
        "daily_summary":           True,
        "sma_offline":             True,
        "sma_error":               True,
        "sma_day_summary":         True,
        "anomaly_stale_sensors":   True,
        "anomaly_unusual_peaks":   True,
        "anomaly_inverter_faults": True,
        "battery_low":             True,
        "battery_full":            False,
        "grid_import_started":     False,
    },
    "discord_battery_low_threshold":  10,   # %: SoC < dit → battery_low alert
    "discord_battery_full_threshold": 95,   # %: SoC >= dit → battery_full alert
}


def load_strategy_settings() -> dict:
    try:
        with open(STRATEGY_SETTINGS_FILE, "r", encoding="utf-8") as f:
            stored = json.load(f)
        result = {**DEFAULT_SETTINGS, **stored}
    except FileNotFoundError:
        result = dict(DEFAULT_SETTINGS)
    except json.JSONDecodeError as exc:
        log.warning("strategy_settings.json corrupt, using defaults: %s", exc)
        result = dict(DEFAULT_SETTINGS)
    except OSError as exc:
        log.warning("strategy_settings.json read error, using defaults: %s", exc)
        result = dict(DEFAULT_SETTINGS)
    # SMA Sunny Boy does not respond to Modbus MBAP over UDP — only TCP works.
    # Silently correct any saved True so a stale setting cannot re-enable UDP.
    result["sma_reader_use_udp"] = False
    return result


def save_strategy_settings(patch: dict) -> dict:
    current = load_strategy_settings()
    current.update({k: v for k, v in patch.items() if k in DEFAULT_SETTINGS})
    with open(STRATEGY_SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)
    return current


def compute_price_complexity(prices: list, settings: Optional[dict] = None) -> dict:
    """
    Analyse price spread to choose the right engine for auto mode.

    Returns a dict with:
      selected_engine: "rule_based" | "claude" | "openai"
      model:           model id, or None for rule_based
      provider:        "claude", "openai", or None
      complexity:      "flat" | "average" | "complex"
      spread_eur_kwh:  p75 − p25 of market prices
      has_negative:    any price < 0
      reason:          human-readable Dutch explanation
    """
    s = settings or load_strategy_settings()
    threshold_low  = float(s.get("auto_complexity_threshold",      0.03))
    threshold_high = float(s.get("auto_complexity_high_threshold", 0.06))
    ai_provider    = s.get("strategy_ai_provider", "claude").lower()

    if ai_provider == "openai":
        model_simple   = s.get("auto_openai_model_simple",  "gpt-4o-mini")
        model_complex  = s.get("auto_openai_model_complex", "gpt-4o")
        provider       = "openai"
    else:  # default to claude
        model_simple   = s.get("auto_claude_model_simple",  "claude-haiku-4-5-20251001")
        model_complex  = s.get("auto_claude_model_complex", "claude-sonnet-4-6")
        provider       = "claude"

    vals = [float(p["marketPrice"]) for p in (prices or [])
            if p.get("marketPrice") is not None]
    if not vals:
        return {
            "selected_engine": "rule_based", "model": None, "provider": None,
            "complexity": "flat", "spread_eur_kwh": 0.0, "has_negative": False,
            "reason": "geen prijsdata beschikbaar",
        }

    sorted_vals  = sorted(vals)
    n            = len(sorted_vals)
    p25          = sorted_vals[int(n * 0.25)]
    p75          = sorted_vals[int(n * 0.75)]
    spread       = p75 - p25
    has_negative = any(v < 0 for v in vals)

    if spread < threshold_low and not has_negative:
        return {
            "selected_engine": "rule_based", "model": None, "provider": None,
            "complexity": "flat", "spread_eur_kwh": spread, "has_negative": False,
            "reason": (f"vlakke dag — spread {spread*100:.1f}ct < {threshold_low*100:.0f}ct, "
                       "geen negatieve prijzen"),
        }

    if spread >= threshold_high or has_negative:
        parts = []
        if has_negative:
            parts.append("negatieve prijzen aanwezig")
        if spread >= threshold_high:
            parts.append(f"grote spread {spread*100:.1f}ct ≥ {threshold_high*100:.0f}ct")
        return {
            "selected_engine": provider, "model": model_complex, "provider": provider,
            "complexity": "complex", "spread_eur_kwh": spread, "has_negative": has_negative,
            "reason": f"complexe dag — {', '.join(parts)}",
        }

    return {
        "selected_engine": provider, "model": model_simple, "provider": provider,
        "complexity": "average", "spread_eur_kwh": spread, "has_negative": False,
        "reason": (f"gemiddelde dag — spread {spread*100:.1f}ct "
                   f"({threshold_low*100:.0f}–{threshold_high*100:.0f}ct)"),
    }


# ---------------------------------------------------------------------------
# Action constants
# ---------------------------------------------------------------------------

SOLAR_CHARGE = "solar_charge"
GRID_CHARGE  = "grid_charge"
SAVE         = "save"
DISCHARGE    = "discharge"
NEUTRAL      = "neutral"


# ---------------------------------------------------------------------------
# Core algorithm
# ---------------------------------------------------------------------------

def _build_price_slots(prices: list[dict], tz) -> dict:
    """Convert raw price list to {slot_key: avg_eur_kwh} hourly buckets in local tz."""
    price_by_slot: dict = {}
    for p in prices:
        try:
            dt_raw = datetime.fromisoformat(p["from"])
            dt_local = dt_raw.replace(tzinfo=tz) if dt_raw.tzinfo is None else dt_raw.astimezone(tz)
            slot_key = dt_local.replace(minute=0, second=0, microsecond=0).isoformat()
            existing = price_by_slot.get(slot_key, [])
            if isinstance(existing, list):
                existing.append(float(p["marketPrice"]))
                price_by_slot[slot_key] = existing
            else:
                price_by_slot[slot_key] = [existing, float(p["marketPrice"])]
        except Exception:
            pass
    return {k: (sum(v) / len(v) if isinstance(v, list) else v) for k, v in price_by_slot.items()}


def _build_solar_slots(solar_wh: dict, tz) -> dict:
    """Convert forecast.solar watt_hours_period dict to {slot_key: wh} hourly buckets."""
    solar_by_slot: dict = {}
    for k, wh in (solar_wh or {}).items():
        try:
            dt_str = k if "T" in k else k.replace(" ", "T")
            dt = datetime.fromisoformat(dt_str)
            dt = dt.replace(tzinfo=tz) if dt.tzinfo is None else dt.astimezone(tz)
            slot_key = dt.replace(minute=0, second=0, microsecond=0).isoformat()
            solar_by_slot[slot_key] = solar_by_slot.get(slot_key, 0.0) + float(wh)
        except (ValueError, TypeError) as exc:
            log.debug("solar_wh key %r skipped: %s", k, exc)
    return solar_by_slot


def _build_consumption_index(consumption_by_hour: list) -> tuple:
    """Return (cons_by_wd_hour, cons_by_hour) index dicts from raw consumption list."""
    cons_by_wd_hour: dict = {}
    cons_by_hour:    dict = {}
    for x in (consumption_by_hour or []):
        h  = int(x["hour"])
        v  = float(x["avg_wh"])
        wd = x.get("weekday")
        if wd is not None:
            cons_by_wd_hour[(int(wd), h)] = v
        else:
            cons_by_hour[h] = v
    return cons_by_wd_hour, cons_by_hour


def _detect_standby(s: dict, cons_by_wd_hour: dict, cons_by_hour: dict, has_wd_data: bool) -> float:
    """Return standby power (W): configured value or auto-detected from 04–05h average."""
    configured = float(s.get("standby_w", 0))
    if configured > 0:
        log.debug("strategy: standby_w=%.0f W (configured)", configured)
        return configured

    vals: list[float] = []
    for h in (4, 5):
        if has_wd_data:
            for wd in range(7):
                v = cons_by_wd_hour.get((wd, h))
                if v is not None:
                    vals.append(v)
        else:
            v = cons_by_hour.get(h)
            if v is not None:
                vals.append(v)
    result = sum(vals) / len(vals) if vals else 0.0
    log.debug("strategy: standby_w=%.0f W (auto-detected)", result)
    return result


def _build_peak_classifier(s: dict, cons_by_wd_hour: dict, cons_by_hour: dict,
                            has_wd_data: bool, standby_w: float):
    """Return an _is_peak(weekday, hour) callable based on settings and consumption data."""
    manual_peaks = s.get("manual_peak_hours", [])

    def _excess(wh: float) -> float:
        return max(0.0, wh - standby_w)

    if manual_peaks:
        _manual_set = {int(h) for h in manual_peaks}
        return lambda wd, h: h in _manual_set

    if has_wd_data:
        _wd_peaks: dict = {}
        for wd in range(7):
            wd_excess = {h: _excess(cons_by_wd_hour.get((wd, h), 0.0)) for h in range(24)}
            threshold = sorted(wd_excess.values())[int(24 * 0.75)]
            _wd_peaks[wd] = {h for h, e in wd_excess.items()
                             if e >= threshold and e > standby_w * 0.20}
        return lambda wd, h: h in _wd_peaks.get(wd, {7, 8, 9, 17, 18, 19, 20, 21})

    if cons_by_hour:
        _excess_vals = {h: _excess(c) for h, c in cons_by_hour.items()}
        threshold    = sorted(_excess_vals.values())[int(len(_excess_vals) * 0.75)]
        _peaks       = {h for h, e in _excess_vals.items()
                        if e >= threshold and e > standby_w * 0.20}
        return lambda wd, h: h in _peaks

    return lambda wd, h: h in {7, 8, 9, 17, 18, 19, 20, 21}


def build_plan(
    prices: list[dict],          # [{from, till, marketPrice, ...}] sorted asc
    solar_wh: dict[str, float],  # {slot_key: Wh} from forecast.solar watt_hours_period
    consumption_by_hour: list[dict],  # [{hour: int, avg_wh: float}]  0..23
    bat_soc_now: float,          # current SOC 0..100
    settings: Optional[dict] = None,
    start_dt: Optional[datetime] = None,  # force a specific start time (historical mode)
    num_slots: int = 48,         # number of hourly slots to simulate
) -> list[dict]:
    """
    Build a 48-slot (hourly) charging plan for today + tomorrow.
    Returns list of slot dicts sorted by time.
    """
    s = settings or load_strategy_settings()

    # PV limiter plan parameters (read once for all slots)
    _pv_enabled   = bool(s.get("pv_limiter_enabled", False))
    _pv_manual    = bool(s.get("pv_limiter_manual_override", False))
    _pv_manual_w  = int(s.get("pv_limiter_manual_w", 2000))
    _pv_min_w     = int(s.get("pv_limiter_min_w", 50))
    _pv_max_w     = int(s.get("pv_limiter_max_w", 4000))
    _pv_thresh    = float(s.get("pv_limiter_threshold_ct", 0.0)) / 100.0  # ct → €/kWh

    cap_kwh       = float(s["bat_capacity_kwh"])
    rte           = float(s["rte"])
    depr          = float(s["depreciation_eur_kwh"])
    min_soc       = float(s["min_reserve_soc"]) / 100.0
    max_soc       = float(s["max_soc"]) / 100.0
    max_charge_kw = float(s["max_charge_kw"])
    price_source  = s.get("price_source", "entsoe")
    # Frank Energie prices are all-in (taxes + markup included) — adding markup would double-count.
    markup        = 0.0 if price_source == "frank" else float(s["grid_markup_eur_kwh"])
    tz_name       = s.get("timezone", "Europe/Brussels")
    tz            = ZoneInfo(tz_name)
    neg_dis_en     = bool(s.get("neg_price_discharge_enabled", True))
    neg_dis_ahead  = int(s.get("neg_price_lookahead_h", 4))
    neg_dis_thresh = s.get("neg_price_threshold_ct", 0.0) / 100.0  # ct → €/kWh

    cons_by_wd_hour, cons_by_hour = _build_consumption_index(consumption_by_hour)
    has_wd_data = bool(cons_by_wd_hour)

    def _cons(weekday: int, hour: int) -> float:
        if has_wd_data:
            return cons_by_wd_hour.get((weekday, hour), cons_by_hour.get(hour, 300.0))
        return cons_by_hour.get(hour, 300.0)

    price_slots   = _build_price_slots(prices, tz)
    solar_by_slot = _build_solar_slots(solar_wh, tz)
    standby_w     = _detect_standby(s, cons_by_wd_hour, cons_by_hour, has_wd_data)
    _is_peak      = _build_peak_classifier(s, cons_by_wd_hour, cons_by_hour, has_wd_data, standby_w)

    # ── Generate hourly window ───────────────────────────────────────────────
    real_now = datetime.now(tz).replace(minute=0, second=0, microsecond=0)
    if start_dt is not None:
        now_local = start_dt.astimezone(tz).replace(minute=0, second=0, microsecond=0)
    else:
        # Start from midnight of today so the full day is visible
        now_local = real_now.replace(hour=0, minute=0, second=0, microsecond=0)
    all_slots = [now_local + timedelta(hours=i) for i in range(num_slots)]

    # Gather all prices for statistics
    known_prices = [price_slots[sl.isoformat()] for sl in all_slots if sl.isoformat() in price_slots]
    if known_prices:
        sorted_prices = sorted(known_prices)
        n = len(sorted_prices)
        p25 = sorted_prices[int(n * 0.25)]
        p75 = sorted_prices[int(n * 0.75)]
        price_median = sorted_prices[n // 2]
    else:
        p25 = p75 = price_median = 0.10

    # ── Simulate battery state over time ────────────────────────────────────
    bat_kwh = cap_kwh * (bat_soc_now / 100.0)
    bat_min = cap_kwh * min_soc
    bat_max = cap_kwh * max_soc

    slots: list[dict] = []

    for i, slot_dt in enumerate(all_slots):
        # Snap to actual SOC at the current hour so that future predictions
        # start from the real battery state, not from a simulated past that
        # may have diverged from reality.
        if slot_dt == real_now:
            bat_kwh = cap_kwh * (bat_soc_now / 100.0)

        slot_key = slot_dt.isoformat()
        hour     = slot_dt.hour
        weekday  = slot_dt.weekday()   # 0 = Monday, 6 = Sunday
        price_raw = price_slots.get(slot_key)
        buy_price = (price_raw + markup) if price_raw is not None else None

        solar_wh_slot  = solar_by_slot.get(slot_key, 0.0)
        cons_wh_slot   = _cons(weekday, hour)

        # Determine PV limit for this slot before any decision logic so that
        # SOLAR_CHARGE is never selected when the PV limiter has cut output to 0.
        if not _pv_enabled:
            _pv_limit_w = None
        elif _pv_manual:
            _pv_limit_w = _pv_manual_w
        elif buy_price is not None:
            _pv_limit_w = _pv_min_w if buy_price < _pv_thresh else _pv_max_w
        else:
            _pv_limit_w = None

        if _pv_limit_w is not None:
            solar_wh_slot = solar_wh_slot * (_pv_limit_w / _pv_max_w) if _pv_max_w > 0 else 0.0

        net_wh         = solar_wh_slot - cons_wh_slot   # positive = solar excess

        soc_start = (bat_kwh / cap_kwh) * 100.0

        action  = NEUTRAL
        reason  = ""
        charge_kwh = 0.0   # energy added to battery this slot (kWh)
        discharge_kwh = 0.0
        # ── Decision logic ───────────────────────────────────────────────────

        # When the raw market price is negative, never allow discharge — even if
        # markup pushes the effective buy_price above the threshold.
        _raw_is_neg = price_raw is not None and price_raw < 0

        # Pre-compute upcoming negative price window — count hours so we can
        # calculate exactly how much headroom to reserve for grid charging.
        _upcoming_neg = False
        _neg_hours = 0
        _neg_headroom_kwh = 0.0
        _neg_target_bat_kwh = bat_max
        if neg_dis_en and buy_price is not None and buy_price >= neg_dis_thresh and not _raw_is_neg:
            for j in range(i + 1, min(i + neg_dis_ahead + 1, num_slots)):
                fp_raw = price_slots.get(all_slots[j].isoformat())
                if fp_raw is not None and (fp_raw + markup) < neg_dis_thresh:
                    _upcoming_neg = True
                    _neg_hours += 1
            if _upcoming_neg:
                # Reserve exactly as much headroom as the inverter can absorb during
                # the negative window (neg_hours × max_charge_kw × rte), capped at
                # usable capacity.  This prevents both over- and under-reservation.
                _neg_headroom_kwh = min(_neg_hours * max_charge_kw * rte,
                                        bat_max - bat_min)
                _neg_target_bat_kwh = max(bat_min, bat_max - _neg_headroom_kwh)

        if buy_price is not None and (buy_price < neg_dis_thresh or _raw_is_neg):
            # Negative/below-threshold price: always GRID_CHARGE regardless of SOC.
            # Consuming from grid is FREE or PAID — signal GRID_CHARGE so inverter
            # pulls from grid even when battery is full.
            if bat_kwh < bat_max - 0.05:
                can_add_kwh = bat_max - bat_kwh
                charge_kwh  = min(can_add_kwh / rte, max_charge_kw)
                bat_kwh    += charge_kwh * rte
            action = GRID_CHARGE
            reason = f"Negatieve prijs ({buy_price*100:.1f}ct) – laden = gratis/betaald"

        elif net_wh > 50:
            if _upcoming_neg:
                # Upcoming free/negative grid price window.  Target the battery to
                # exactly max_soc − headroom so the inverter can absorb the full
                # negative-window capacity from the grid.
                # NEUTRAL is insufficient here because the inverter self-consumption
                # mode still auto-charges from solar surplus.  Use SAVE (freeze) when
                # battery is at/above target so solar exports to grid instead.
                _neg_target_soc = (_neg_target_bat_kwh / cap_kwh) * 100.0
                if bat_kwh > _neg_target_bat_kwh + 0.1:
                    # Battery above target: freeze it; solar exports to grid.
                    action = SAVE
                    reason = (f"SOC {soc_start:.0f}% > doel {_neg_target_soc:.0f}% – "
                              f"zon naar net, bewaar {_neg_headroom_kwh:.1f} kWh "
                              f"voor {_neg_hours}u netladen")
                else:
                    # Battery below target: charge from solar only up to target.
                    absorb_kwh = min(net_wh / 1000.0,
                                     _neg_target_bat_kwh - bat_kwh,
                                     max_charge_kw)
                    if absorb_kwh > 0.05:
                        bat_kwh   += absorb_kwh * rte
                        charge_kwh = absorb_kwh
                        action = SOLAR_CHARGE
                        reason = (f"Zonneladen tot doel {_neg_target_soc:.0f}% "
                                  f"(bewaar {_neg_headroom_kwh:.1f} kWh voor "
                                  f"{_neg_hours}u netladen)")
                    else:
                        # Exactly at target: freeze.
                        action = SAVE
                        reason = (f"Doel {_neg_target_soc:.0f}% bereikt – "
                                  f"zon naar net, wachten op {_neg_hours}u netladen")
            else:
                # Solar excess: charge battery from solar (free)
                absorb_kwh = min(net_wh / 1000.0, bat_max - bat_kwh, max_charge_kw)
                if absorb_kwh > 0.05:
                    bat_kwh   += absorb_kwh * rte
                    charge_kwh = absorb_kwh
                    action = SOLAR_CHARGE
                    reason = f"Zonne-overschot {solar_wh_slot:.0f} Wh"
                else:
                    action = NEUTRAL
                    reason = "Batterij vol of minimale overschot"

        elif buy_price is not None:
            # Look ahead: max price in next 8 hours (for charge profitability)
            future_prices_8 = [
                price_slots[all_slots[j].isoformat()] + markup
                for j in range(i + 1, min(i + 9, num_slots))
                if all_slots[j].isoformat() in price_slots
            ]
            max_future = max(future_prices_8) if future_prices_8 else buy_price

            # Best price in next 16 hours (for discharge reservation decisions)
            future_prices_16 = [
                price_slots[all_slots[j].isoformat()] + markup
                for j in range(i + 1, min(i + 17, num_slots))
                if all_slots[j].isoformat() in price_slots
            ]
            best_future_16 = max(future_prices_16) if future_prices_16 else buy_price

            is_peak_hour = _is_peak(weekday, hour)

            # _upcoming_neg already computed above (before solar branch)

            # Effective charge cost = buy_price / rte + charge depreciation.
            eff_charge_cost = buy_price / rte + depr   # €/kWh stored
            charge_spread   = max_future - eff_charge_cost
            min_spread      = s.get("min_charge_spread_eur_kwh", 0.05)
            is_cheap        = buy_price < p25 * 1.05
            grid_charge_ok  = charge_spread >= min_spread or (is_cheap and charge_spread > 0)

            # Solar-fill check: if remaining solar today would fill the battery
            # without grid charging, skip grid_charge (solar is free).
            remaining_solar_today_wh = sum(
                solar_by_slot.get(all_slots[j].isoformat(), 0.0)
                for j in range(i, num_slots)
                if all_slots[j].date() == slot_dt.date()
            )
            solar_fills_battery = (
                remaining_solar_today_wh / 1000.0 * rte >= (bat_max - bat_kwh) - 0.1
            )

            if _upcoming_neg and not _raw_is_neg:
                # Negative price expected: steer battery toward the calculated target
                # so exactly enough headroom is available for grid charging.
                _neg_target_soc = (_neg_target_bat_kwh / cap_kwh) * 100.0
                if bat_kwh > _neg_target_bat_kwh + 0.1:
                    # Above target: discharge toward it (limited to consumption drain).
                    discharge_possible = min(
                        max(0.0, -net_wh) / 1000.0,
                        bat_kwh - _neg_target_bat_kwh,
                        bat_kwh - bat_min,
                    )
                    if discharge_possible > 0.05:
                        bat_kwh      -= discharge_possible
                        discharge_kwh = discharge_possible
                        action = DISCHARGE
                        reason = (f"Ontladen naar doel {_neg_target_soc:.0f}% – "
                                  f"bewaar {_neg_headroom_kwh:.1f} kWh voor "
                                  f"{_neg_hours}u netladen")
                    else:
                        action = NEUTRAL
                elif is_peak_hour and bat_kwh > bat_min + 0.2 and buy_price >= price_median:
                    # At/below target but peak hour: discharge is still OK because the
                    # upcoming negative window will recharge the battery for free.
                    discharge_possible = min(max(0.0, -net_wh) / 1000.0, bat_kwh - bat_min)
                    if discharge_possible > 0.05:
                        bat_kwh      -= discharge_possible
                        discharge_kwh = discharge_possible
                        action = DISCHARGE
                        reason = (f"Piekuur ontladen ({buy_price*100:.1f}ct) – "
                                  f"negatief netladen volgt in {_neg_hours}u")
                    else:
                        action = NEUTRAL
                        reason = "Batterij te leeg voor ontladen"
                elif buy_price > p75 and bat_kwh > bat_min + 0.2:
                    # Expensive hour above p75: discharge even if below target.
                    discharge_possible = min(max(0.0, -net_wh) / 1000.0, bat_kwh - bat_min)
                    if discharge_possible > 0.05:
                        bat_kwh      -= discharge_possible
                        discharge_kwh = discharge_possible
                        action = DISCHARGE
                        reason = (f"Duur uur ({buy_price*100:.1f}ct) – "
                                  f"negatief netladen volgt in {_neg_hours}u")
                    else:
                        action = NEUTRAL
                else:
                    # Not a peak or expensive hour: anti-feed mode, don't charge from grid.
                    # Battery drains naturally from house consumption (anti-feed).
                    action = NEUTRAL
                    reason = (f"Anti-feed – geen netladen, wachten op {_neg_hours}u "
                              f"negatieve prijs (SoC {soc_start:.0f}% → doel {_neg_target_soc:.0f}%)")

            elif is_peak_hour and bat_kwh > bat_min + 0.2 and buy_price >= price_median:
                # Peak hour AND price is at or above the day's median.
                # If a much better (>15%) discharge opportunity is within 16h,
                # hold the charge for that instead.
                if best_future_16 > buy_price * 1.15:
                    action = SAVE
                    reason = f"Sparen voor duurder uur ({best_future_16*100:.0f}ct)"
                else:
                    discharge_possible = min(max(0.0, -net_wh) / 1000.0, bat_kwh - bat_min)
                    if discharge_possible > 0.05:
                        bat_kwh      -= discharge_possible
                        discharge_kwh = discharge_possible
                        action = DISCHARGE
                        reason = f"Piekuur verbruik ~{-net_wh:.0f} Wh (netto)"
                    else:
                        action = NEUTRAL
                        reason = "Batterij te leeg voor ontladen"

            elif grid_charge_ok and bat_kwh < bat_max - 0.2 and not solar_fills_battery:
                # Spread large enough → charge from grid now to discharge later
                can_add_kwh  = bat_max - bat_kwh
                charge_kwh   = min(can_add_kwh / rte, max_charge_kw)
                bat_kwh     += charge_kwh * rte
                action = GRID_CHARGE
                reason = (f"Spread {charge_spread*100:.1f}ct/kWh "
                          f"(koop {buy_price*100:.1f}ct → piek {max_future*100:.1f}ct)")

            elif buy_price > p75 and bat_kwh > bat_min + 0.2:
                # Expensive slot: use battery — but save for even better hours
                if best_future_16 > buy_price * 1.15:
                    action = SAVE
                    reason = f"Sparen voor duurder uur ({best_future_16*100:.0f}ct)"
                else:
                    discharge_possible = min(max(0.0, -net_wh) / 1000.0, bat_kwh - bat_min)
                    if discharge_possible > 0.05:
                        bat_kwh      -= discharge_possible
                        discharge_kwh = discharge_possible
                        action = DISCHARGE
                        reason = f"Duur net ({buy_price*100:.1f}ct/kWh)"

            elif bat_kwh > bat_min + 0.3:
                # Battery has charge — decide whether to save or go neutral
                upcoming_peak = any(
                    _is_peak(all_slots[j].weekday(), all_slots[j].hour)
                    for j in range(i + 1, min(i + 6, num_slots))
                )
                # A much more expensive hour is coming soon (30% above current AND above p75)
                better_soon = best_future_16 > buy_price * (1.0 + s.get("save_price_factor", 0.30)) and best_future_16 > p75

                if buy_price > price_median and upcoming_peak:
                    action = SAVE
                    reason = "Sparen voor komende piekuren"
                elif better_soon:
                    action = SAVE
                    reason = f"Goedkoop nu ({buy_price*100:.0f}ct) – sparen voor {best_future_16*100:.0f}ct"
                else:
                    action = NEUTRAL
            else:
                action = NEUTRAL

        # ── Neutral SOC simulation ────────────────────────────────────────
        # anti-feed: battery covers net consumption when no explicit charge/
        # discharge action is set.  Without this the predicted SOC stays flat
        # overnight which is misleading (sluipverbruik drains the battery).
        if action == NEUTRAL:
            if net_wh >= 0:
                surplus_kwh = (net_wh / 1000.0) * rte
                headroom    = (max_soc * cap_kwh) - bat_kwh
                store       = min(surplus_kwh, headroom)
                if store > 0:
                    bat_kwh += store
            else:
                avail = bat_kwh - (min_soc * cap_kwh)
                use   = min((-net_wh) / 1000.0, avail)
                if use > 0:
                    bat_kwh -= use

        soc_end = (bat_kwh / cap_kwh) * 100.0

        slots.append({
            "time":           slot_key,
            "hour":           hour,
            "price_eur_kwh":  round(buy_price, 4) if buy_price is not None else None,
            "price_raw":      round(price_raw, 4) if price_raw is not None else None,
            "solar_wh":       round(solar_wh_slot, 0),
            "consumption_wh": round(cons_wh_slot, 0),
            "net_wh":         round(net_wh, 0),
            "action":         action,
            "reason":         reason,
            "charge_kwh":     round(charge_kwh, 3),
            "discharge_kwh":  round(discharge_kwh, 3),
            "soc_start":      round(soc_start, 1),
            "soc_end":        round(soc_end, 1),
            "is_peak":        _is_peak(weekday, hour),
            "is_past":        slot_dt < real_now,
            "pv_limit_w":     _pv_limit_w,
        })

    return slots


# ---------------------------------------------------------------------------
# Convenience: split today / tomorrow
# ---------------------------------------------------------------------------

def read_soc_cache(soc_file: str, max_age_s: float = 300) -> Optional[float]:
    """Return SOC from a last_soc.json cache file if it is fresher than max_age_s.

    Returns None when the file is missing, unreadable, stale, or contains an
    out-of-range value.  Extracted here so it can be unit-tested without Flask.
    """
    import time
    try:
        with open(soc_file, encoding="utf-8") as f:
            data = json.load(f)
        age_s = time.time() - data.get("ts", 0)
        if age_s < max_age_s:
            val = float(data["soc"])
            if 0.0 <= val <= 100.0:
                return val
    except Exception:
        pass
    return None


def split_days(slots: list[dict]) -> dict:
    today_str    = datetime.now().date().isoformat()
    tomorrow_str = (datetime.now().date() + timedelta(days=1)).isoformat()
    return {
        "today":    [s for s in slots if s["time"].startswith(today_str)],
        "tomorrow": [s for s in slots if s["time"].startswith(tomorrow_str)],
        "all":      slots,
    }
