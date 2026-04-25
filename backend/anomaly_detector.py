import json
import logging
import os
import time
from datetime import datetime, timedelta
from typing import Optional

import pytz
from influx_writer import query_recent_points

log = logging.getLogger("marstek")

DATA_DIR = os.environ.get("MARSTEK_DATA_DIR", os.path.dirname(os.path.abspath(__file__)))
ANOMALIES_FILE = os.path.join(DATA_DIR, "_anomalies.json")
STALE_SENSOR_THRESHOLD = 3600  # 1 hour in seconds


def load_anomalies() -> dict:
    """Load anomaly detection state."""
    if os.path.exists(ANOMALIES_FILE):
        try:
            with open(ANOMALIES_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"stale_sensors": {}, "last_check": None, "alerts_sent": []}


def save_anomalies(state: dict) -> None:
    """Save anomaly detection state."""
    with open(ANOMALIES_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


def detect_stale_sensors(hours: int = 24) -> dict:
    """
    Detect sensors that haven't reported data in >STALE_SENSOR_THRESHOLD seconds.
    Returns dict with sensor names and last update times.
    """
    stale = {}
    now = time.time()

    try:
        points = query_recent_points(hours=hours)

        # Group by field name and get latest timestamp
        # query_recent_points returns {"time": ISO, "solar_w": val, "net_w": val, ...}
        sensor_times = {}
        for point in points:
            time_str = point.get("time")
            if not time_str:
                continue

            # Parse ISO timestamp to Unix timestamp
            try:
                dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
                timestamp = dt.timestamp()
            except (ValueError, AttributeError):
                continue

            # Check all fields in the point
            for field in ("solar_w", "net_w", "bat_w", "bat_soc", "house_w", "ev_w"):
                if field in point:
                    if field not in sensor_times:
                        sensor_times[field] = timestamp
                    else:
                        sensor_times[field] = max(sensor_times[field], timestamp)

        # Check for stale sensors
        for sensor_name, last_timestamp in sensor_times.items():
            age_s = now - last_timestamp
            if age_s > STALE_SENSOR_THRESHOLD:
                stale[sensor_name] = {
                    "last_update": datetime.fromtimestamp(last_timestamp, tz=pytz.UTC).isoformat(),
                    "age_seconds": int(age_s),
                    "age_hours": round(age_s / 3600, 1),
                }
    except Exception as e:
        log.warning("detect_stale_sensors: %s", e)

    return stale


def detect_unusual_peaks(hours: int = 24, threshold_multiplier: float = 2.0) -> dict:
    """
    Detect unusual power peaks. A peak is unusual if it exceeds
    the average by threshold_multiplier times.
    """
    peaks = {}

    try:
        points = query_recent_points(hours=hours)

        # Group by field name and calculate statistics
        field_values = {}
        for point in points:
            for field in ("solar_w", "net_w", "bat_w", "house_w", "ev_w"):
                value = point.get(field)
                if value is not None and isinstance(value, (int, float)):
                    if field not in field_values:
                        field_values[field] = []
                    field_values[field].append(value)

        # Detect peaks
        for field_name, values in field_values.items():
            if len(values) < 3:
                continue

            avg = sum(values) / len(values)
            max_val = max(values)

            if avg > 0 and max_val > avg * threshold_multiplier:
                peaks[field_name] = {
                    "max_value": max_val,
                    "average": round(avg, 2),
                    "ratio": round(max_val / avg, 2),
                }
    except Exception as e:
        log.warning("detect_unusual_peaks: %s", e)

    return peaks


def detect_inverter_faults() -> dict:
    """
    Detect inverter faults by checking for zero/error states
    in power generation when sunlight expected.
    """
    faults = {}

    try:
        points = query_recent_points(hours=2)

        # Check for zero generation during day (rough heuristic)
        tz = pytz.timezone("Europe/Brussels")
        now_local = datetime.now(tz)
        hour = now_local.hour

        # If between 6am-6pm, expect some PV generation
        if 6 <= hour < 18:
            pv_values = []
            for point in points:
                value = point.get("solar_w")
                if value is not None:
                    pv_values.append(value)

            # If all PV values are 0/near-0 during day, it's likely a fault
            if pv_values and all(v < 0.1 for v in pv_values):
                faults["pv_generation"] = {
                    "status": "No PV generation detected during daylight",
                    "hour": hour,
                    "samples": len(pv_values),
                }
    except Exception as e:
        log.warning("detect_inverter_faults: %s", e)

    return faults


def run_anomaly_detection() -> dict:
    """
    Run all anomaly detection checks. Returns anomalies found.
    """
    state = load_anomalies()

    # Detect anomalies
    stale = detect_stale_sensors()
    peaks = detect_unusual_peaks()
    faults = detect_inverter_faults()

    anomalies = {
        "timestamp": datetime.utcnow().isoformat(),
        "stale_sensors": stale,
        "unusual_peaks": peaks,
        "inverter_faults": faults,
    }

    # Update state
    state["stale_sensors"] = stale
    state["last_check"] = anomalies["timestamp"]
    if stale or peaks or faults:
        state["alerts_sent"] = state.get("alerts_sent", [])[-100:]  # Keep last 100
        state["alerts_sent"].append(anomalies)

    save_anomalies(state)

    return anomalies


def get_anomaly_summary() -> dict:
    """Get current anomaly state for API response."""
    state = load_anomalies()

    return {
        "stale_sensors": state.get("stale_sensors", {}),
        "last_check": state.get("last_check"),
        "alert_count": len(state.get("alerts_sent", [])),
    }
