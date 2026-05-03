"""
discord.py – FLUX Discord webhook notificaties.

Stuurt energiealerts rechtstreeks naar een Discord-kanaal via een webhook URL.
Geen bot-token of extra service nodig — alleen de webhook URL instellen.
"""

import json
import logging
import time
import threading
from typing import Optional
from urllib.error import URLError
from urllib.request import Request, urlopen

log = logging.getLogger("discord")

# Embed-kleuren per event-type (Discord gebruikt decimale kleurwaarden)
_COLORS = {
    "plan_ready":              0x5865F2,   # blauw
    "grid_charge_opportunity": 0x57F287,   # groen
    "esphome_failed":          0xED4245,   # rood
    "daily_summary":           0xFEE75C,   # geel
    "sma_offline":             0xEB459E,   # roze
    "sma_error":               0xED4245,   # rood
    "sma_day_summary":         0x5865F2,   # blauw
    "anomaly_stale_sensors":   0xED4245,   # rood
    "anomaly_unusual_peaks":   0xFEE75C,   # oranje/geel
    "anomaly_inverter_faults": 0xED4245,   # rood
    "battery_low":             0xED4245,   # rood
    "battery_full":            0x57F287,   # groen
    "grid_import_started":     0xFEE75C,   # geel
    "test":                    0x5865F2,   # blauw
}
_DEFAULT_COLOR = 0x99AAB5  # grijs


def _build_embed(event_type: str, payload: dict | str) -> dict:
    """Vertaal een event + payload naar een Discord embed-object."""
    color = _COLORS.get(event_type, _DEFAULT_COLOR)

    if event_type == "plan_ready":
        title = "⚡ FLUX: Energieplan klaar"
        desc = (
            f"**Slots vandaag:** {payload.get('slots_today', '?')}\n"
            f"**Netstroom laden:** {payload.get('grid_charge_hours', 0)} uur\n"
            f"**Ontladen:** {payload.get('discharge_hours', 0)} uur\n"
            f"**SoC nu:** {payload.get('soc_now', '?')}%\n"
            f"**Engine:** {payload.get('engine', '?')}"
        )
    elif event_type == "grid_charge_opportunity":
        price = payload.get("price_eur_kwh")
        price_str = f"{price:.3f} €/kWh" if price is not None else "onbekend"
        soc = payload.get("soc")
        soc_str = f"{soc:.0f}%" if soc is not None else "onbekend"
        title = "💰 FLUX: Voordelig netladen"
        desc = (
            f"**Prijs:** {price_str}\n"
            f"**SoC:** {soc_str}\n"
            f"**Aanbevolen:** {payload.get('recommended_kwh', '?')} kWh"
        )
    elif event_type == "daily_summary":
        title = "📊 FLUX: Dagelijkse energiesamenvatting"
        soc = payload.get("soc_now")
        soc_str = f"{soc:.0f}%" if soc is not None else "onbekend"
        desc = (
            f"**Datum:** {payload.get('date', '?')}\n"
            f"**Netstroom geladen:** {payload.get('grid_charge_hours', 0)} uur\n"
            f"**Zonnestroom geladen:** {payload.get('solar_charge_hours', 0)} uur\n"
            f"**Ontladen:** {payload.get('discharge_hours', 0)} uur\n"
            f"**SoC nu:** {soc_str}"
        )
    elif event_type == "battery_low":
        soc = payload.get("soc", "?")
        title = "🔴 FLUX: Batterij bijna leeg"
        desc = f"**SoC:** {soc}% — onder de kritieke drempel."
    elif event_type == "battery_full":
        soc = payload.get("soc", "?")
        title = "🟢 FLUX: Batterij volledig opgeladen"
        desc = f"**SoC:** {soc}%"
    elif event_type == "grid_import_started":
        title = "🔌 FLUX: Netimport gestart"
        soc = payload.get("soc", "?")
        power = payload.get("power_w")
        power_str = f"{power} W" if power is not None else "onbekend"
        desc = f"**SoC:** {soc}%\n**Vermogen:** {power_str}"
    elif event_type == "esphome_failed":
        title = "❌ FLUX: ESPHome-commando mislukt"
        desc = (
            f"**Commando:** {payload.get('action', '?')}\n"
            f"**Fout:** {payload.get('error', '?')}"
        )
    elif event_type in ("sma_offline", "sma_error"):
        title = "⚠️ FLUX: SMA-omvormer probleem"
        desc = str(payload.get("message") or payload.get("error") or payload)
    elif event_type == "sma_day_summary":
        title = "☀️ FLUX: SMA dagopbrengst"
        desc = str(payload)
    elif event_type in ("anomaly_stale_sensors", "anomaly_unusual_peaks",
                        "anomaly_inverter_faults"):
        labels = {
            "anomaly_stale_sensors":   ("⚠️ FLUX: Verouderde sensoren", "sensors"),
            "anomaly_unusual_peaks":   ("⚠️ FLUX: Ongewone piekbelasting", "peaks"),
            "anomaly_inverter_faults": ("🔴 FLUX: Omvormerfout", "faults"),
        }
        label, key = labels[event_type]
        title = label
        count = payload.get("count", "?")
        desc = f"**Aantal:** {count}\n**Details:** {json.dumps(payload.get(key, {}), ensure_ascii=False)[:300]}"
    elif event_type == "test":
        title = "✅ FLUX: Discord webhook werkt"
        msg = payload.get("message") if isinstance(payload, dict) else str(payload)
        desc = msg or "Testbericht ontvangen."
    else:
        title = f"FLUX: {event_type}"
        desc = json.dumps(payload, ensure_ascii=False)[:1000] if isinstance(payload, dict) else str(payload)[:1000]

    embed = {
        "title":       title,
        "description": desc,
        "color":       color,
        "footer":      {"text": "FLUX Energy"},
        "timestamp":   _utc_iso(),
    }
    return embed


def _utc_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


# Deduplicatie: voorkom dubbele berichten binnen korte tijd
_dedup_lock = threading.Lock()
_dedup: dict[str, float] = {}   # event_type → last_sent_epoch
_DEDUP_S = 300  # 5 minuten cooldown per event-type


def _is_duplicate(event_type: str) -> bool:
    now = time.time()
    with _dedup_lock:
        last = _dedup.get(event_type, 0.0)
        if now - last < _DEDUP_S:
            return True
        _dedup[event_type] = now
        return False


def notify_event(
    event_type: str,
    payload: dict | str = "",
    settings: Optional[dict] = None,
    raise_on_error: bool = False,
) -> None:
    """
    Stuur een Discord webhook notificatie voor het gegeven event.

    Silently skips als discord uitgeschakeld is of event uitgeschakeld is.
    """
    try:
        from strategy import load_strategy_settings
        s = settings or load_strategy_settings()
    except Exception:
        s = settings or {}

    if not s.get("discord_enabled", False):
        return

    webhook_url = s.get("discord_webhook_url", "").strip()
    if not webhook_url:
        log.warning("discord.notify_event: discord_enabled=True maar geen webhook URL ingesteld")
        return

    events_cfg: dict = s.get("discord_events", {})
    if event_type != "test" and event_type in events_cfg and not events_cfg[event_type]:
        return

    if _is_duplicate(event_type):
        log.debug("discord.notify_event: %s gededupliceerd (< %ds)", event_type, _DEDUP_S)
        return

    embed = _build_embed(event_type, payload if isinstance(payload, dict) else {"message": payload})
    body = json.dumps({"embeds": [embed]}).encode()

    try:
        req = Request(webhook_url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Content-Length", str(len(body)))
        with urlopen(req, timeout=10) as resp:
            log.info("discord.notify_event: %s verzonden (status=%d)", event_type, resp.status)
    except URLError as exc:
        log.warning("discord.notify_event: %s mislukt: %s", event_type, exc)
        if raise_on_error:
            raise RuntimeError(f"Discord webhook niet bereikbaar: {exc}") from exc
    except Exception as exc:
        log.warning("discord.notify_event: %s onverwachte fout: %s", event_type, exc)
        if raise_on_error:
            raise
