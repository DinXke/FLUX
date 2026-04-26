"""
influx_writer.py – Background thread that polls configured sensors every 30 s
and writes them as time-series points to InfluxDB 2.x.

Sensors collected
-----------------
  ESPHome   : GET /api/states  (direct HTTP, independent of frontend SSE)
  HomeWizard: GET /api/homewizard/data  (internal call reusing app logic)
  HA        : POST /api/ha/poll         (internal call reusing app logic)
  Flow slots: resolved from marstek_flow_cfg.json via the same logic as HomeFlow

The measurement written is ``energy_flow`` with fields:
  solar_w, net_w, bat_w, bat_soc, house_w, ev_w,
  voltage_l1, voltage_l2, voltage_l3,
  net_import_kwh_total, net_export_kwh_total (cumulative P1 kWh counters)
and a tag  source=resolved|fallback.
"""

import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Optional

log = logging.getLogger("influx_writer")

# ---------------------------------------------------------------------------
# InfluxDB connection settings  (matches docker-compose defaults)
# ---------------------------------------------------------------------------

INFLUX_URL    = os.environ.get("INFLUX_URL",    "http://localhost:8086")
INFLUX_TOKEN  = os.environ.get("INFLUX_TOKEN",  "")
INFLUX_ORG    = os.environ.get("INFLUX_ORG",    "flux")
INFLUX_BUCKET = os.environ.get("INFLUX_BUCKET", "energy")

WRITE_INTERVAL = 30   # seconds between writes

# ---------------------------------------------------------------------------
# Lazy InfluxDB client (don't crash if influxdb-client is not installed yet)
# ---------------------------------------------------------------------------

_write_api = None
_influx_ok  = False


def _get_write_api():
    global _write_api, _influx_ok
    if _write_api is not None:
        return _write_api
    try:
        from influxdb_client import InfluxDBClient, WriteOptions  # type: ignore
        from influxdb_client.client.write_api import SYNCHRONOUS   # type: ignore
        client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
        _write_api = client.write_api(write_options=SYNCHRONOUS)
        _influx_ok = True
        log.info("InfluxDB connected  url=%s  org=%s  bucket=%s", INFLUX_URL, INFLUX_ORG, INFLUX_BUCKET)
    except Exception as exc:
        log.warning("InfluxDB not available: %s", exc)
        _write_api = None
    return _write_api


# ---------------------------------------------------------------------------
# Flow-config resolution (mirrors HomeFlow / EnergyMap logic in Python)
# ---------------------------------------------------------------------------

_DATA_DIR     = os.environ.get("MARSTEK_DATA_DIR", os.path.dirname(__file__))
FLOW_CFG_FILE = os.path.join(_DATA_DIR, "flow_cfg.json")


def _load_flow_cfg() -> dict:
    try:
        with open(FLOW_CFG_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        cfg = {}
        for key, val in raw.items():
            if isinstance(val, list):
                cfg[key] = val
            elif isinstance(val, dict):
                cfg[key] = [val]
        return cfg
    except Exception:
        return {}


def _poll_esphome(devices: dict) -> dict:
    """
    Poll each ESPHome device via GET /events (SSE stream) and return
    {device_id: {sensor_key: value}}.
    Reads the initial state burst (until 'ping' event) then closes.
    Sensor keys mirror DeviceCard: batPower, acPower, soc, acVoltage, l1V, l2V, l3V.
    """
    try:
        import requests as _r
        import json as _json
    except ImportError:
        return {}

    # (terms_that_must_all_appear_in_name, target_key)
    # Matched against lowercased entity name with punctuation→space
    NAME_MAP = [
        (["state", "charge"],   "soc"),
        (["battery", "soc"],    "soc"),
        (["bat", "soc"],        "soc"),
        (["laadniveau"],        "soc"),   # Dutch: "laadniveau"
        (["laadstand"],         "soc"),   # Dutch: "laadstand"
        (["battery", "level"],  "soc"),   # "battery level"
        (["battery", "percent"],"soc"),   # "battery percentage"
        (["battery", "power"],  "batPower"),
        (["bat", "power"],      "batPower"),
        (["ac", "power"],       "acPower"),
        (["grid", "power"],     "acPower"),
        (["ac", "voltage"],     "acVoltage"),
        (["l1", "voltage"],     "l1V"),
        (["l2", "voltage"],     "l2V"),
        (["l3", "voltage"],     "l3V"),
        (["voltage", "l1"],     "l1V"),
        (["voltage", "l2"],     "l2V"),
        (["voltage", "l3"],     "l3V"),
    ]

    def _map_name(entity_id: str) -> Optional[str]:
        slash = entity_id.find("/")
        raw   = entity_id[slash + 1:] if slash >= 0 else entity_id
        name  = raw.lower().replace("_", " ").replace(".", " ").replace("-", " ")
        for terms, key in NAME_MAP:
            if all(t in name for t in terms):
                return key
        # Word-exact fallback: entity named just "soc" or "soc_1" etc.
        # Uses word-boundary check to avoid matching "socket".
        if "soc" in name.split():
            return "soc"
        return None

    result = {}
    for dev_id, dev in devices.items():
        ip, port = dev.get("ip"), dev.get("port", 80)
        if not ip:
            continue
        vals: dict = {}
        try:
            with _r.Session() as sess:
                with sess.get(
                    f"http://{ip}:{port}/events",
                    stream=True,
                    timeout=(10, 15),
                    headers={"Accept": "text/event-stream", "Cache-Control": "no-cache"},
                ) as resp:
                    resp.raise_for_status()
                    current_event = None
                    for raw_line in resp.iter_lines(decode_unicode=True):
                        if raw_line.startswith("event:"):
                            current_event = raw_line[6:].strip()
                            if current_event == "ping":
                                break   # initial state burst complete
                        elif raw_line.startswith("data:") and current_event == "state":
                            try:
                                data = _json.loads(raw_line[5:].strip())
                                key  = _map_name(data.get("id", ""))
                                if key:
                                    v = data.get("value")
                                    if v is None:
                                        try:
                                            v = float(str(data.get("state", "")).split()[0])
                                        except Exception:
                                            pass
                                    if v is not None:
                                        vals[key] = float(v)
                            except Exception:
                                pass
        except Exception as exc:
            log.debug("ESPHome SSE poll failed  dev=%s  err=%s", dev_id, exc)
        if vals:
            result[dev_id] = vals
            log.debug("ESPHome SSE  dev=%s  fields=%s", dev_id, list(vals.keys()))
    return result


def _resolve_slot(key: str, cfg: dict, esphome_map: dict,
                  hw_data: Optional[dict], ha_data: dict, sma_data: Optional[dict] = None) -> Optional[float]:
    """Resolve a flow slot → numeric value (mirrors JS resolveSlot)."""
    entries = cfg.get(key)
    if not entries:
        return None
    if not isinstance(entries, list):
        entries = [entries]

    is_avg = (key == "bat_soc")
    total, count = None, 0

    for sc in entries:
        source    = sc.get("source")
        device_id = sc.get("device_id")
        sensor    = sc.get("sensor")
        invert    = sc.get("invert", False)

        v = None
        if source == "esphome":
            v = esphome_map.get(device_id, {}).get(sensor)
        elif source == "homewizard":
            dev = next((d for d in (hw_data or {}).get("devices", []) if d["id"] == device_id), None)
            v = dev["sensors"].get(sensor, {}).get("value") if dev else None
        elif source == "homeassistant":
            entry = ha_data.get(sensor)
            v = entry.get("value") if entry else None
        elif source == "sma":
            v = (sma_data or {}).get(sensor)

        if v is not None:
            total = (total or 0.0) + (-v if invert else v)
            count += 1
        elif source == "sma":
            total = (total or 0.0) + 0.0
            count += 1

    if total is None:
        return None
    return total / count if is_avg and count else total


# ---------------------------------------------------------------------------
# Main collection + write cycle
# ---------------------------------------------------------------------------

def _collect_and_write(app_context_fn):
    """
    One collection cycle.  app_context_fn() returns a dict with:
      devices, hw_data, ha_data, flow_cfg
    fetched inside the Flask app context.
    """
    try:
        ctx = app_context_fn()
    except Exception as exc:
        log.warning("collect context error: %s", exc)
        return

    devices  = ctx.get("devices", {})
    hw_data  = ctx.get("hw_data")
    ha_data  = ctx.get("ha_data", {})
    flow_cfg = ctx.get("flow_cfg", {})

    esphome_map = _poll_esphome(devices)

    sma_data = None
    try:
        from sma_modbus import get_sma_live as _get_sma
        sma = _get_sma()
        if sma.get("online") and sma.get("ts", 0) > 0 and (time.time() - sma["ts"]) < 60:
            sma_data = sma
    except Exception:
        pass

    SLOT_ORDER = ["solar_power", "net_power", "bat_power", "bat_soc",
                  "ev_power", "voltage_l1", "voltage_l2", "voltage_l3",
                  "net_import_kwh_total", "net_export_kwh_total"]
    SLOT_FIELDS = {
        "solar_power":          "solar_w",
        "net_power":            "net_w",
        "bat_power":            "bat_w",
        "bat_soc":              "bat_soc",
        "ev_power":             "ev_w",
        "voltage_l1":           "voltage_l1",
        "voltage_l2":           "voltage_l2",
        "voltage_l3":           "voltage_l3",
        "net_import_kwh_total": "net_import_kwh_total",
        "net_export_kwh_total": "net_export_kwh_total",
    }

    fields = {}
    for slot_key in SLOT_ORDER:
        val = _resolve_slot(slot_key, flow_cfg, esphome_map, hw_data, ha_data, sma_data)
        if val is not None:
            fields[SLOT_FIELDS[slot_key]] = float(val)

    # Auto-detect P1 cumulative kWh counters from HomeWizard devices (when not in flow_cfg).
    # These are always written when available, regardless of selected_sensors config.
    if "net_import_kwh_total" not in fields or "net_export_kwh_total" not in fields:
        _CUMUL_MAP = [
            ("total_power_import_kwh", "net_import_kwh_total"),
            ("total_power_export_kwh", "net_export_kwh_total"),
            ("energy_import_kwh",      "net_import_kwh_total"),
            ("energy_export_kwh",      "net_export_kwh_total"),
        ]
        for hw_sensor_key, influx_field in _CUMUL_MAP:
            if influx_field in fields:
                continue
            for dev_entry in (hw_data or {}).get("devices", []):
                val = dev_entry.get("sensors", {}).get(hw_sensor_key, {}).get("value")
                if val is not None:
                    fields[influx_field] = float(val)
                    break

    # When bat_soc is absent from flow_cfg (or configured for fewer batteries than
    # are registered), fall back to averaging the SOC of ALL polled ESPHome devices.
    # This keeps last_soc.json fresh for multi-battery setups that haven't yet
    # added explicit bat_soc mappings, avoiding the hardcoded 50 % strategy fallback.
    if "bat_soc" not in fields:
        _all_socs = [v["soc"] for v in esphome_map.values() if "soc" in v]
        if _all_socs:
            fields["bat_soc"] = round(sum(_all_socs) / len(_all_socs), 1)
            log.debug(
                "_collect_and_write: bat_soc from all-device fallback (%d devs): %.1f%%",
                len(_all_socs), fields["bat_soc"],
            )

    # house_w derived
    solar = fields.get("solar_w", 0.0)
    net   = fields.get("net_w", 0.0)   # positive = import
    bat   = fields.get("bat_w", 0.0)   # positive = discharge
    ev    = fields.get("ev_w", 0.0)
    # house = solar + bat_discharge - net_export + net_import - ev
    # net positive=import: house = solar + bat - (-net) ... simplify:
    # From the JS: housePower = batDisplay - netDisplay + solar - ev
    # netDisplay = -netRaw (positive=export). Here net_w is positive=import.
    # so netDisplay = -net_w
    # house = bat_w - (-net_w) + solar - ev = bat_w + net_w + solar - ev
    if any(k in fields for k in ("solar_w", "net_w", "bat_w")):
        fields["house_w"] = bat + net + solar - ev

    if not fields:
        log.debug("No fields to write – sensors not configured/reachable")
        return

    # ── Persist bat_soc to a JSON cache so the strategy can always read it ──
    if "bat_soc" in fields:
        import json as _json, time as _time
        _soc_file = os.path.join(_DATA_DIR, "last_soc.json")
        try:
            with open(_soc_file, "w", encoding="utf-8") as _f:
                _json.dump({"soc": fields["bat_soc"], "ts": _time.time()}, _f)
        except Exception:
            pass

    write_api = _get_write_api()
    if write_api is None:
        return

    try:
        from influxdb_client import Point  # type: ignore
        p = Point("energy_flow").tag("source", "marstek")
        for k, v in fields.items():
            p = p.field(k, v)
        p = p.time(datetime.now(timezone.utc))
        write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=p)
        log.debug("InfluxDB write OK  fields=%s", list(fields.keys()))
    except Exception as exc:
        log.warning("InfluxDB write error: %s", exc)

    # ── SMA inverter data (separate measurement) ──────────────────────────────
    try:
        from sma_modbus import get_sma_live as _get_sma  # lazy import to avoid circular
        sma = _get_sma()
        if sma.get("online") and sma.get("ts", 0) > 0 and (time.time() - sma["ts"]) < 60:
            from influxdb_client import Point  # type: ignore
            sma_fields = {
                k: sma[k] for k in (
                    "pac_w", "e_day_wh", "e_total_wh",
                    "grid_v", "freq_hz", "dc_power_w", "dc_voltage_v",
                )
                if sma.get(k) is not None
            }
            if sma_fields:
                sp = Point("sma_inverter")
                if sma.get("status"):
                    sp = sp.tag("status", sma["status"])
                for k, v in sma_fields.items():
                    sp = sp.field(k, float(v))
                sp = sp.time(datetime.now(timezone.utc))
                write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=sp)
                log.debug("InfluxDB SMA write OK  fields=%s", list(sma_fields.keys()))
    except Exception as exc:
        log.debug("InfluxDB SMA write skip: %s", exc)

    # ── Strategy plan slots (48-hour forecast) ──────────────────────────────
    try:
        plan_slots = ctx.get("plan_slots", [])
        if plan_slots:
            from influxdb_client import Point  # type: ignore
            written_count = 0
            for slot in plan_slots:
                try:
                    slot_time = slot.get("time")
                    if not slot_time:
                        continue
                    p = Point("strategy_slot")
                    p = p.tag("action", slot.get("action", "UNKNOWN"))
                    p = p.tag("is_peak", "true" if slot.get("is_peak") else "false")
                    p = p.tag("is_past", "true" if slot.get("is_past") else "false")
                    for k, v in [
                        ("price_eur_kwh", slot.get("price_eur_kwh")),
                        ("solar_wh", slot.get("solar_wh")),
                        ("consumption_wh", slot.get("consumption_wh")),
                        ("net_wh", slot.get("net_wh")),
                        ("charge_kwh", slot.get("charge_kwh")),
                        ("discharge_kwh", slot.get("discharge_kwh")),
                        ("soc_start", slot.get("soc_start")),
                        ("soc_end", slot.get("soc_end")),
                        ("pv_limit_w", slot.get("pv_limit_w")),
                    ]:
                        if v is not None:
                            p = p.field(k, float(v))
                    from datetime import datetime as _dt
                    p = p.time(_dt.fromisoformat(slot_time))
                    write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=p)
                    written_count += 1
                except Exception as e:
                    log.debug("Strategy slot write error (hour %s): %s", slot.get("hour"), e)
            if written_count > 0:
                log.debug("InfluxDB strategy slots write OK  count=%d", written_count)
    except Exception as exc:
        log.debug("InfluxDB strategy slots write skip: %s", exc)

    # ── Solar forecast (hourly prediction) ───────────────────────────────────
    try:
        forecast_data = ctx.get("solar_forecast", {})
        if forecast_data:
            from influxdb_client import Point  # type: ignore
            from datetime import datetime as _dt
            written_count = 0
            for slot_time_str, wh in forecast_data.items():
                try:
                    if not wh:
                        continue
                    p = Point("solar_forecast")
                    p = p.field("forecasted_wh", float(wh))
                    slot_dt = _dt.fromisoformat(slot_time_str) if "T" in slot_time_str else _dt.fromisoformat(slot_time_str.replace(" ", "T"))
                    if slot_dt.tzinfo is None:
                        from zoneinfo import ZoneInfo
                        slot_dt = slot_dt.replace(tzinfo=ZoneInfo("UTC"))
                    p = p.time(slot_dt)
                    write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=p)
                    written_count += 1
                except Exception as e:
                    log.debug("Solar forecast write error (%s): %s", slot_time_str, e)
            if written_count > 0:
                log.debug("InfluxDB solar forecast write OK  count=%d", written_count)
    except Exception as exc:
        log.debug("InfluxDB solar forecast write skip: %s", exc)

    # ── Anomaly alerts ──────────────────────────────────────────────────────
    try:
        anomalies = ctx.get("anomalies", {})
        if anomalies:
            from influxdb_client import Point  # type: ignore
            from datetime import datetime as _dt
            alert_count = 0

            stale_sensors = anomalies.get("stale_sensors", {})
            for sensor_name, last_update_ts in stale_sensors.items():
                try:
                    p = Point("anomaly_alert")
                    p = p.tag("type", "stale_sensor")
                    p = p.tag("sensor", sensor_name)
                    p = p.field("description", f"No data for {stale_sensors[sensor_name]} seconds")
                    p = p.time(datetime.now(timezone.utc))
                    write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=p)
                    alert_count += 1
                except Exception as e:
                    log.debug("Stale sensor alert write error: %s", e)

            unusual_peaks = anomalies.get("unusual_peaks", {})
            for sensor_name, peak_info in unusual_peaks.items():
                try:
                    p = Point("anomaly_alert")
                    p = p.tag("type", "power_spike")
                    p = p.tag("sensor", sensor_name)
                    p = p.field("description", f"Unusual power spike detected")
                    p = p.time(datetime.now(timezone.utc))
                    write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=p)
                    alert_count += 1
                except Exception as e:
                    log.debug("Peak alert write error: %s", e)

            inverter_faults = anomalies.get("inverter_faults", {})
            for inv_name, fault_info in inverter_faults.items():
                try:
                    p = Point("anomaly_alert")
                    p = p.tag("type", "inverter_fault")
                    p = p.tag("inverter", inv_name)
                    p = p.field("description", fault_info.get("status", "Unknown fault"))
                    p = p.time(datetime.now(timezone.utc))
                    write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=p)
                    alert_count += 1
                except Exception as e:
                    log.debug("Inverter fault alert write error: %s", e)

            if alert_count > 0:
                log.debug("InfluxDB anomaly alerts write OK  count=%d", alert_count)
    except Exception as exc:
        log.debug("InfluxDB anomaly alerts write skip: %s", exc)


# ---------------------------------------------------------------------------
# Background thread entry point
# ---------------------------------------------------------------------------

def start_background_writer(app_context_fn, interval: int = WRITE_INTERVAL):
    """
    Spawn a daemon thread that calls _collect_and_write every `interval` seconds.
    app_context_fn must be callable and return the context dict.
    """
    def _loop():
        log.info("InfluxDB background writer started  interval=%ds", interval)
        while True:
            _collect_and_write(app_context_fn)
            time.sleep(interval)

    t = threading.Thread(target=_loop, daemon=True, name="influx-writer")
    t.start()
    return t


# ---------------------------------------------------------------------------
# Query helpers (used by strategy endpoint)
# ---------------------------------------------------------------------------

def query_avg_hourly_consumption(days: int = 21,
                                 tz_name: str = "Europe/Brussels") -> list[dict]:
    """
    Return average consumption per (weekday, hour-of-day).
    weekday: 0 = Monday … 6 = Sunday (Python convention).
    Returns list of dicts: {weekday: int, hour: int, avg_wh: float},
    up to 7×24 = 168 entries (only entries with data are included).
    """
    write_api = _get_write_api()
    if write_api is None:
        return []

    try:
        from influxdb_client import InfluxDBClient  # type: ignore
        from zoneinfo import ZoneInfo
        client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
        query_api = client.query_api()

        # Fetch hourly averages; weekday grouping is done in Python so
        # timezone conversions are handled correctly.
        flux = f"""
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: -{days}d)
  |> filter(fn: (r) => r._measurement == "energy_flow" and r._field == "house_w")
  |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)
"""
        tables = query_api.query(flux, org=INFLUX_ORG)
        tz = ZoneInfo(tz_name)
        by_wd_hour: dict[tuple, list] = {}
        for table in tables:
            for record in table.records:
                val = record.get_value()
                if val is None:
                    continue
                t = record.get_time().astimezone(tz)
                key = (t.weekday(), t.hour)
                by_wd_hour.setdefault(key, []).append(float(val))

        result = []
        for (wd, h), vals in sorted(by_wd_hour.items()):
            result.append({"weekday": wd, "hour": h, "avg_wh": round(sum(vals) / len(vals), 1)})
        return result
    except Exception as exc:
        log.warning("InfluxDB hourly query error: %s", exc)
        return []


def query_day_actuals(date_str: str, tz_name: str = "Europe/Brussels") -> dict:
    """
    Return actual hourly energy-flow data for a specific calendar date from InfluxDB.
    Keys are hour integers (0-23); values are dicts with available fields.
    Used by the strategy historical-day view.
    """
    write_api = _get_write_api()
    if write_api is None:
        return {}
    try:
        from zoneinfo import ZoneInfo
        from datetime import date as _date, datetime as _dt
        tz = ZoneInfo(tz_name)
        d = _date.fromisoformat(date_str)
        day_start = _dt(d.year, d.month, d.day, 0, 0, 0, tzinfo=tz)
        day_end   = _dt(d.year, d.month, d.day, 23, 59, 59, tzinfo=tz)
        start_utc = day_start.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")
        end_utc   = day_end.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")

        from influxdb_client import InfluxDBClient  # type: ignore
        client    = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
        query_api = client.query_api()

        flux = f"""
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: {start_utc}, stop: {end_utc})
  |> filter(fn: (r) => r._measurement == "energy_flow")
  |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)
  |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
"""
        tables = query_api.query(flux, org=INFLUX_ORG)
        result: dict[int, dict] = {}
        for table in tables:
            for record in table.records:
                t    = record.get_time().astimezone(tz)
                hour = t.hour
                row  = {}
                for field in ("solar_w", "net_w", "bat_w", "bat_soc", "house_w", "ev_w"):
                    v = record.values.get(field)
                    if v is not None:
                        row[field] = round(float(v), 1)
                if row:
                    result[hour] = row
        return result
    except Exception as exc:
        log.warning("InfluxDB day actuals error (%s): %s", date_str, exc)
        return {}


def query_soc_history(days: int = 32, tz_name: str = "Europe/Brussels") -> dict:
    """
    Return actual hourly bat_soc readings for the last N days from InfluxDB.
    Single bulk query — much faster than calling query_day_actuals per day.
    Returns {date_iso: {hour_int: soc_pct}}.
    """
    write_api = _get_write_api()
    if write_api is None:
        return {}
    try:
        from zoneinfo import ZoneInfo
        from datetime import datetime as _dt, timedelta as _td, timezone as _tz
        tz     = ZoneInfo(tz_name)
        utcnow = _dt.now(_tz.utc)
        start  = (utcnow - _td(days=days)).strftime("%Y-%m-%dT00:00:00Z")

        from influxdb_client import InfluxDBClient  # type: ignore
        client    = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
        query_api = client.query_api()

        flux = f"""
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: {start})
  |> filter(fn: (r) => r._measurement == "energy_flow" and r._field == "bat_soc")
  |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)
"""
        tables = query_api.query(flux, org=INFLUX_ORG)
        result: dict = {}
        for table in tables:
            for record in table.records:
                v = record.get_value()
                if v is None:
                    continue
                t        = record.get_time().astimezone(tz)
                date_str = t.date().isoformat()
                result.setdefault(date_str, {})[t.hour] = round(float(v), 1)
        return result
    except Exception as exc:
        log.warning("InfluxDB soc_history error: %s", exc)
        return {}


def query_recent_points(hours: int = 24) -> list[dict]:
    """
    Return last `hours` hours of energy_flow data as list of dicts.
    Used for the live chart on the strategy page.
    """
    write_api = _get_write_api()
    if write_api is None:
        return []

    try:
        from influxdb_client import InfluxDBClient  # type: ignore
        client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
        query_api = client.query_api()

        flux = f"""
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: -{hours}h)
  |> filter(fn: (r) => r._measurement == "energy_flow")
  |> aggregateWindow(every: 15m, fn: mean, createEmpty: false)
  |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
"""
        tables = query_api.query(flux, org=INFLUX_ORG)
        result = []
        for table in tables:
            for record in table.records:
                row = {"time": record.get_time().isoformat()}
                for field in ("solar_w","net_w","bat_w","bat_soc","house_w","ev_w"):
                    v = record.values.get(field)
                    if v is not None:
                        row[field] = round(float(v), 1)
                result.append(row)
        result.sort(key=lambda x: x["time"])
        return result
    except Exception as exc:
        log.warning("InfluxDB recent query error: %s", exc)
        return []


def query_hourly_import_export_kwh(date_str: str,
                                   tz_name: str = "Europe/Brussels") -> dict:
    """
    Return hourly Δkwh from local P1 cumulative counter data in InfluxDB.

    Uses spread() (max − min within each 1h window) on net_import_kwh_total
    and net_export_kwh_total, which for monotonically increasing counters equals
    the energy actually imported / exported during that hour.

    Returns {hour_int: {"import_kwh": float, "export_kwh": float}}.
    Empty dict when no data is available.
    """
    write_api = _get_write_api()
    if write_api is None:
        return {}
    try:
        from influxdb_client import InfluxDBClient  # type: ignore
        from zoneinfo import ZoneInfo
        from datetime import date as _date, datetime as _dt, timedelta as _td
        tz = ZoneInfo(tz_name)
        d = _date.fromisoformat(date_str)
        day_start = _dt(d.year, d.month, d.day, 0, 0, 0, tzinfo=tz)
        day_end   = _dt(d.year, d.month, d.day, 0, 0, 0, tzinfo=tz) + _td(days=1)
        start_utc = day_start.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")
        end_utc   = day_end.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")

        client    = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
        query_api = client.query_api()

        result: dict[int, dict] = {}
        for influx_field, out_key in [("net_import_kwh_total", "import_kwh"),
                                       ("net_export_kwh_total", "export_kwh")]:
            # spread() = max - min within each 1h window.
            # For cumulative counters this equals the energy delta for that hour.
            # timeSrc: "_start" so the timestamp is the START of the window (hour N → bucket N).
            flux = f"""
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: {start_utc}, stop: {end_utc})
  |> filter(fn: (r) => r._measurement == "energy_flow" and r._field == "{influx_field}")
  |> aggregateWindow(every: 1h, fn: spread, createEmpty: false, timeSrc: "_start")
"""
            tables = query_api.query(flux, org=INFLUX_ORG)
            for table in tables:
                for record in table.records:
                    v = record.get_value()
                    if v is None or v < 0.0:
                        continue
                    t    = record.get_time().astimezone(tz)
                    hour = t.hour
                    if t.date().isoformat() != date_str:
                        continue
                    result.setdefault(hour, {})[out_key] = round(float(v), 4)

        return result
    except Exception as exc:
        log.warning("InfluxDB import/export delta query error (%s): %s", date_str, exc)
        return {}
