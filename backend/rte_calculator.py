"""
rte_calculator.py – Compute measured Round-Trip Efficiency (RTE) from InfluxDB.

Uses the ``bat_w`` field in the ``energy_flow`` measurement:
  - bat_w > 0  → battery discharging (energy out)
  - bat_w < 0  → battery charging   (energy in)

Flux ``integral(unit: 1h)`` integrates Watts over hours → Wh.
Divide by 1000 → kWh.

RTE = total_discharge_kwh / total_charge_kwh

Falls back to None when insufficient data (< min_kwh charged or
window too short for a reliable estimate).
"""

import logging
import os

log = logging.getLogger("rte_calculator")

INFLUX_URL    = os.environ.get("INFLUX_URL",    "http://localhost:8086")
INFLUX_TOKEN  = os.environ.get("INFLUX_TOKEN",  "marstek-influx-token-local")
INFLUX_ORG    = os.environ.get("INFLUX_ORG",    "marstek")
INFLUX_BUCKET = os.environ.get("INFLUX_BUCKET", "energy")

# Minimum kWh charged before we trust the measurement.
_MIN_CHARGE_KWH = 5.0

# Cache: avoid querying InfluxDB on every strategy call.
_cache: dict = {}
_CACHE_TTL = 3600  # seconds


def measure_rte(window_days: int = 30, min_kwh: float = _MIN_CHARGE_KWH) -> dict:
    """
    Query InfluxDB and return measured RTE.

    Returns::

        {
            "rte": float | None,          # None when not enough data
            "charge_kwh": float,
            "discharge_kwh": float,
            "window_days": int,
            "confidence": "high" | "medium" | "low" | "insufficient",
            "source": "measured" | "insufficient_data",
        }

    The result is cached for _CACHE_TTL seconds.
    """
    import time

    cache_key = (window_days, min_kwh)
    cached = _cache.get(cache_key)
    if cached and time.time() - cached["_ts"] < _CACHE_TTL:
        return {k: v for k, v in cached.items() if k != "_ts"}

    result = _query_rte(window_days, min_kwh)
    _cache[cache_key] = {**result, "_ts": time.time()}
    return result


def invalidate_cache() -> None:
    _cache.clear()


def _query_rte(window_days: int, min_kwh: float) -> dict:
    empty = {
        "rte": None,
        "charge_kwh": 0.0,
        "discharge_kwh": 0.0,
        "window_days": window_days,
        "confidence": "insufficient",
        "source": "insufficient_data",
    }
    try:
        from influxdb_client import InfluxDBClient  # type: ignore
        client    = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
        query_api = client.query_api()
    except Exception as exc:
        log.warning("rte_calculator: cannot connect to InfluxDB: %s", exc)
        return empty

    charge_kwh    = _integrate_bat_w(query_api, window_days, mode="charge")
    discharge_kwh = _integrate_bat_w(query_api, window_days, mode="discharge")

    if charge_kwh is None or discharge_kwh is None:
        return empty

    if charge_kwh < min_kwh:
        log.info("rte_calculator: insufficient charge data (%.2f kWh < %.1f kWh min)", charge_kwh, min_kwh)
        return {**empty, "charge_kwh": round(charge_kwh, 3), "discharge_kwh": round(discharge_kwh, 3)}

    rte = discharge_kwh / charge_kwh if charge_kwh > 0 else None

    # Clamp to physically meaningful range.
    if rte is not None:
        rte = max(0.5, min(1.0, rte))

    if charge_kwh >= 50:
        confidence = "high"
    elif charge_kwh >= 15:
        confidence = "medium"
    else:
        confidence = "low"

    log.info(
        "rte_calculator: window=%dd  charge=%.2f kWh  discharge=%.2f kWh  rte=%.4f  confidence=%s",
        window_days, charge_kwh, discharge_kwh, rte or 0, confidence,
    )

    return {
        "rte":          round(rte, 4) if rte is not None else None,
        "charge_kwh":   round(charge_kwh, 3),
        "discharge_kwh": round(discharge_kwh, 3),
        "window_days":  window_days,
        "confidence":   confidence,
        "source":       "measured",
    }


def _integrate_bat_w(query_api, window_days: int, mode: str) -> float | None:
    """
    Integrate bat_w over the window.

    mode="charge"    → sum of abs(bat_w) when bat_w < 0  (energy in)
    mode="discharge" → sum of bat_w      when bat_w > 0  (energy out)

    Returns energy in kWh, or None on query error.
    """
    # Flux: keep only the sign we want, then integrate (W·h / 1000 = kWh).
    if mode == "charge":
        # Charging: bat_w < 0; take absolute value.
        filter_expr = "r._value < 0.0"
        map_expr    = "-r._value"
    else:
        # Discharging: bat_w > 0.
        filter_expr = "r._value > 0.0"
        map_expr    = "r._value"

    flux = f"""
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: -{window_days}d)
  |> filter(fn: (r) => r._measurement == "energy_flow" and r._field == "bat_w")
  |> filter(fn: (r) => {filter_expr})
  |> map(fn: (r) => ({{r with _value: {map_expr}}}))
  |> integral(unit: 1h)
"""
    try:
        tables = query_api.query(flux, org=INFLUX_ORG)
        total_wh = 0.0
        for table in tables:
            for record in table.records:
                v = record.get_value()
                if v is not None:
                    total_wh += float(v)
        return total_wh / 1000.0  # Wh → kWh
    except Exception as exc:
        log.warning("rte_calculator: integral query error (mode=%s): %s", mode, exc)
        return None
