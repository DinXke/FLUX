import json
import logging
import os
from datetime import datetime, timedelta, timezone

import pandas as pd
import pytz

log = logging.getLogger("marstek")

DATA_DIR = os.environ.get("MARSTEK_DATA_DIR", os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(DATA_DIR, "device_models")

INFLUX_URL    = os.environ.get("INFLUX_URL",    "http://localhost:8086")
INFLUX_TOKEN  = os.environ.get("INFLUX_TOKEN",  "")
INFLUX_ORG    = os.environ.get("INFLUX_ORG",    "flux")
INFLUX_BUCKET = os.environ.get("INFLUX_BUCKET", "energy")

MIN_DATA_DAYS = 2


def _ensure_models_dir() -> None:
    os.makedirs(MODELS_DIR, exist_ok=True)


def _get_local_tz() -> pytz.BaseTzInfo:
    try:
        from config import get_config
        cfg = get_config()
        tz_name = cfg.get("entsoe", {}).get("timezone") or "Europe/Brussels"
        return pytz.timezone(tz_name)
    except Exception:
        return pytz.timezone("Europe/Brussels")


def _query_device_power(device_id: str, days: int = 56) -> pd.DataFrame:
    """Query device_power from InfluxDB for a specific device_id."""
    try:
        from influxdb_client import InfluxDBClient

        utcnow = datetime.now(timezone.utc)
        start = (utcnow - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00Z")

        client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
        query_api = client.query_api()

        flux = f"""
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: {start})
  |> filter(fn: (r) => r._measurement == "device_power" and r.device_id == "{device_id}")
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
"""
        tables = query_api.query(flux, org=INFLUX_ORG)
        rows = []
        for table in tables:
            for record in table.records:
                rows.append({
                    "timestamp": record.get_time(),
                    "power_w": float(record.values.get("power_w") or 0.0),
                    "energy_kwh_delta": float(record.values.get("energy_kwh_delta") or 0.0),
                })

        if not rows:
            return pd.DataFrame(columns=["timestamp", "power_w", "energy_kwh_delta"])

        df = pd.DataFrame(rows)
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
        df = df.sort_values("timestamp").reset_index(drop=True)
        return df

    except Exception as e:
        log.warning("_query_device_power(%s): %s", device_id, e)
        return pd.DataFrame(columns=["timestamp", "power_w", "energy_kwh_delta"])


def detect_cycles(df: pd.DataFrame, on_threshold_w: float = 50.0, min_duration_min: float = 5.0) -> pd.DataFrame:
    """Detect on/off cycles based on power level."""
    if df.empty or "power_w" not in df.columns:
        return pd.DataFrame(columns=["start", "end", "duration_min", "energy_kwh"])

    on = df["power_w"] > on_threshold_w
    cycles = []
    start = None

    for idx, is_on in on.items():
        if is_on and start is None:
            start = idx
        elif not is_on and start is not None:
            duration = (df.loc[idx, "timestamp"] - df.loc[start, "timestamp"]).total_seconds() / 60
            if duration >= min_duration_min:
                energy = df.loc[start:idx, "energy_kwh_delta"].sum()
                cycles.append({
                    "start": df.loc[start, "timestamp"],
                    "end": df.loc[idx, "timestamp"],
                    "duration_min": round(duration, 1),
                    "energy_kwh": round(float(energy), 4),
                })
            start = None

    return pd.DataFrame(cycles)


def compute_device_stats(device_id: str) -> dict:
    """
    Compute usage statistics for a device.
    Returns avg kWh/week, avg cycles/week, typical start hour, avg duration.
    """
    df = _query_device_power(device_id, days=56)
    if df.empty:
        return {"device_id": device_id, "status": "no_data"}

    days_available = (df["timestamp"].max() - df["timestamp"].min()).total_seconds() / 86400
    if days_available < MIN_DATA_DAYS:
        return {
            "device_id": device_id,
            "status": "insufficient_data",
            "days_available": round(days_available, 1),
            "min_days_required": MIN_DATA_DAYS,
        }

    cycles = detect_cycles(df)
    weeks = max(1, days_available / 7)

    total_energy_kwh = float(df["energy_kwh_delta"].sum())
    avg_kwh_week = round(total_energy_kwh / weeks, 3)
    avg_cycles_week = round(len(cycles) / weeks, 1) if not cycles.empty else 0.0

    typical_start_hour = None
    avg_duration_min = None
    if not cycles.empty:
        local_tz = _get_local_tz()
        start_hours = cycles["start"].dt.tz_convert(local_tz).dt.hour
        typical_start_hour = round(float(start_hours.mean()), 1)
        avg_duration_min = round(float(cycles["duration_min"].mean()), 1)

    return {
        "device_id": device_id,
        "status": "ok",
        "days_available": round(days_available, 1),
        "avg_kwh_week": avg_kwh_week,
        "avg_cycles_week": avg_cycles_week,
        "typical_start_hour": typical_start_hour,
        "avg_duration_min": avg_duration_min,
        "total_cycles": len(cycles),
    }


def _model_cache_path(device_id: str, kind: str) -> str:
    _ensure_models_dir()
    safe = device_id.replace("/", "_").replace("\\", "_")
    return os.path.join(MODELS_DIR, f"{safe}_{kind}.json")


def _load_model_cache(device_id: str, kind: str) -> dict | None:
    path = _model_cache_path(device_id, kind)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _save_model_cache(device_id: str, kind: str, data: dict) -> None:
    path = _model_cache_path(device_id, kind)
    data["cached_at"] = datetime.utcnow().isoformat()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _is_cache_fresh(cache: dict, max_age_hours: int = 24) -> bool:
    cached_at = cache.get("cached_at")
    if not cached_at:
        return False
    try:
        age_h = (datetime.utcnow() - datetime.fromisoformat(cached_at)).total_seconds() / 3600
        return age_h < max_age_hours
    except Exception:
        return False


def build_device_forecast(device_id: str, forecast_days: int = 7, use_cache: bool = True) -> dict:
    """
    Build 7-day daily energy + cycle forecast for a device using Prophet.
    Returns cached result if <24 hours old.
    """
    if use_cache:
        cache = _load_model_cache(device_id, "energy")
        if cache and _is_cache_fresh(cache, max_age_hours=24):
            return cache.get("forecast", {})

    try:
        from prophet import Prophet

        df = _query_device_power(device_id, days=56)
        if df.empty:
            return {"device_id": device_id, "status": "no_data", "data": []}

        days_available = (df["timestamp"].max() - df["timestamp"].min()).total_seconds() / 86400
        if days_available < MIN_DATA_DAYS:
            return {
                "device_id": device_id,
                "status": "insufficient_data",
                "days_available": round(days_available, 1),
                "data": [],
            }

        local_tz = _get_local_tz()
        df["local_date"] = df["timestamp"].dt.tz_convert(local_tz).dt.date
        daily = df.groupby("local_date")["energy_kwh_delta"].sum().reset_index()
        daily.columns = ["ds", "y"]
        daily["ds"] = pd.to_datetime(daily["ds"])

        if len(daily) < 3:
            return {"device_id": device_id, "status": "insufficient_data", "data": []}

        use_weekly = days_available >= 14

        model = Prophet(
            yearly_seasonality=False,
            weekly_seasonality=use_weekly,
            daily_seasonality=False,
            interval_width=0.9,
        )
        with _suppress_prophet_warnings():
            model.fit(daily)

        future = model.make_future_dataframe(periods=forecast_days, freq="D")
        with _suppress_prophet_warnings():
            forecast_df = model.predict(future)

        last_train = daily["ds"].max()
        future_rows = forecast_df[forecast_df["ds"] > last_train]

        cycles_df = detect_cycles(df)
        cycles = detect_cycles(df)
        avg_cycles_per_day = 0.0
        if not cycles.empty:
            avg_cycles_per_day = len(cycles) / max(1, days_available)

        data = []
        for _, row in future_rows.iterrows():
            data.append({
                "ds": row["ds"].strftime("%Y-%m-%d"),
                "energy_kwh": round(max(0.0, float(row["yhat"])), 3),
                "energy_kwh_upper": round(max(0.0, float(row["yhat_upper"])), 3),
                "energy_kwh_lower": round(max(0.0, float(row["yhat_lower"])), 3),
                "cycles": round(avg_cycles_per_day, 1),
            })

        result = {
            "device_id": device_id,
            "status": "success",
            "trained_on_days": round(days_available, 1),
            "data": data,
        }
        _save_model_cache(device_id, "energy", {"forecast": result})
        return result

    except Exception as e:
        log.error("build_device_forecast(%s): %s", device_id, e)
        return {"device_id": device_id, "status": "error", "error": str(e), "data": []}


def list_known_device_ids() -> list[str]:
    """Return device_ids that have stored model cache files."""
    _ensure_models_dir()
    ids = set()
    for fname in os.listdir(MODELS_DIR):
        if fname.endswith("_energy.json") or fname.endswith("_cycles.json"):
            ids.add(fname.rsplit("_", 1)[0])
    return sorted(ids)


class _suppress_prophet_warnings:
    def __enter__(self):
        import warnings
        self._w = warnings
        warnings.filterwarnings("ignore", category=UserWarning)
        return self

    def __exit__(self, *args):
        self._w.resetwarnings()
