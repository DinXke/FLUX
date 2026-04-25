import json
import logging
import os
from datetime import datetime, timedelta

import pandas as pd
import pytz
from prophet import Prophet

log = logging.getLogger("marstek")

DATA_DIR = os.environ.get("MARSTEK_DATA_DIR", os.path.dirname(os.path.abspath(__file__)))
FORECAST_FILE = os.path.join(DATA_DIR, "_prophet_forecast.json")

# InfluxDB configuration (same as influx_writer)
INFLUX_URL    = os.environ.get("INFLUX_URL", "http://localhost:8086")
INFLUX_TOKEN  = os.environ.get("INFLUX_TOKEN", "")
INFLUX_ORG    = os.environ.get("INFLUX_ORG", "my-org")
INFLUX_BUCKET = os.environ.get("INFLUX_BUCKET", "energy")


def _query_hourly_consumption(days: int = 32, tz_name: str = "Europe/Brussels") -> list[dict]:
    """
    Query hourly consumption (house_w) from InfluxDB for the last N days.
    Returns list of dicts with 'timestamp' (ISO) and 'consumption_kwh' fields.
    """
    try:
        from influxdb_client import InfluxDBClient
        from zoneinfo import ZoneInfo
        from datetime import datetime as _dt, timedelta as _td, timezone as _tz

        tz = ZoneInfo(tz_name)
        utcnow = _dt.now(_tz.utc)
        start = (utcnow - _td(days=days)).strftime("%Y-%m-%dT00:00:00Z")

        client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
        query_api = client.query_api()

        # Query hourly house_w (consumption) over the last N days
        flux = f"""
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: {start})
  |> filter(fn: (r) => r._measurement == "energy_flow" and r._field == "house_w")
  |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)
"""
        tables = query_api.query(flux, org=INFLUX_ORG)
        result = []

        for table in tables:
            for record in table.records:
                value_w = record.get_value()
                if value_w is None:
                    continue

                t = record.get_time()
                # Convert watts to kilowatt-hours (hourly average = W/1000)
                # Actually for hourly data, if we have W avg over 1h, the energy is W*1h/1000 = W/1000 kWh
                # But Prophet works better with consistent units, so let's keep it as kW (W/1000)
                value_kw = float(value_w) / 1000.0

                result.append({
                    "timestamp": t.isoformat(),
                    "consumption_kwh": value_kw,
                })

        result.sort(key=lambda x: x["timestamp"])
        return result

    except Exception as e:
        log.warning("_query_hourly_consumption error: %s", e)
        return []


def load_forecast_cache() -> dict:
    """Load cached forecast."""
    if os.path.exists(FORECAST_FILE):
        try:
            with open(FORECAST_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"forecast": None, "cached_at": None}


def save_forecast_cache(forecast_data: dict) -> None:
    """Save forecast to cache."""
    cache = {
        "forecast": forecast_data,
        "cached_at": datetime.utcnow().isoformat(),
    }
    with open(FORECAST_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2)


def build_prophet_forecast(days_history: int = 32, forecast_days: int = 7) -> dict:
    """
    Build 7-day hourly consumption forecast using Prophet.
    Trains on 32 days of InfluxDB hourly consumption history.

    Returns dict with forecast data points.
    """
    try:
        # Query historical consumption data
        consumption = _query_hourly_consumption(days=days_history)

        if not consumption or len(consumption) < 24:
            log.warning("prophet: not enough data (have %d points)", len(consumption) or 0)
            return {
                "status": "insufficient_data",
                "data": [],
                "message": f"Need at least 24 hours, have {len(consumption) or 0}",
            }

        # Prepare data for Prophet: requires 'ds' (timestamp) and 'y' (value)
        df_data = []
        for point in consumption:
            timestamp = point.get("timestamp")
            value = point.get("consumption_kwh")

            if timestamp and value is not None:
                # Parse ISO timestamp
                if isinstance(timestamp, str):
                    dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                else:
                    dt = datetime.fromtimestamp(timestamp, tz=pytz.UTC)

                df_data.append({
                    "ds": dt,
                    "y": float(value),
                })

        if not df_data:
            return {
                "status": "no_valid_data",
                "data": [],
                "message": "No valid consumption data found",
            }

        df = pd.DataFrame(df_data)
        df = df.sort_values("ds").reset_index(drop=True)

        log.info("prophet: training on %d hourly points (%s to %s)",
                 len(df), df["ds"].min(), df["ds"].max())

        # Train Prophet model
        # Use yearly and weekly seasonality; suppress warnings
        model = Prophet(
            yearly_seasonality=True,
            weekly_seasonality=True,
            daily_seasonality=True,
            interval_width=0.95,  # 95% confidence interval
            stan_backend="CMDSTANPY" if _has_cmdstan() else None,
        )

        # Fit on historical data
        with _suppress_prophet_warnings():
            model.fit(df)

        # Create future dataframe for 7 days ahead
        future = model.make_future_dataframe(periods=forecast_days * 24, freq="h")

        # Generate forecast
        with _suppress_prophet_warnings():
            forecast = model.predict(future)

        # Extract only future points (beyond training data)
        last_train_date = df["ds"].max()
        future_forecast = forecast[forecast["ds"] > last_train_date].copy()

        # Format output
        forecast_points = []
        for _, row in future_forecast.iterrows():
            forecast_points.append({
                "timestamp": row["ds"].isoformat(),
                "forecast": round(max(0, row["yhat"]), 3),  # Consumption can't be negative
                "upper": round(max(0, row["yhat_upper"]), 3),
                "lower": round(max(0, row["yhat_lower"]), 3),
            })

        result = {
            "status": "success",
            "trained_on_points": len(df),
            "trained_on_days": round((df["ds"].max() - df["ds"].min()).total_seconds() / 86400, 1),
            "forecast_start": forecast_points[0]["timestamp"] if forecast_points else None,
            "forecast_end": forecast_points[-1]["timestamp"] if forecast_points else None,
            "data": forecast_points,
        }

        # Cache the forecast
        save_forecast_cache(result)

        return result

    except Exception as e:
        log.error("prophet: forecast failed: %s", e)
        return {
            "status": "error",
            "data": [],
            "error": str(e),
        }


def get_prophet_forecast(use_cache: bool = True) -> dict:
    """
    Get Prophet forecast. Use cache if available and recent (<6 hours).
    """
    if use_cache:
        cache = load_forecast_cache()
        if cache.get("forecast"):
            cached_at = cache.get("cached_at")
            if cached_at:
                try:
                    cached_time = datetime.fromisoformat(cached_at)
                    age_h = (datetime.utcnow() - cached_time).total_seconds() / 3600
                    if age_h < 6:
                        log.debug("prophet: using cached forecast (%.1f h old)", age_h)
                        return cache["forecast"]
                except ValueError:
                    pass

    # Build fresh forecast
    return build_prophet_forecast()


def _has_cmdstan() -> bool:
    """Check if cmdstanpy is available (optional optimization)."""
    try:
        import cmdstanpy
        return True
    except ImportError:
        return False


class _suppress_prophet_warnings:
    """Context manager to suppress Prophet's verbose logging."""
    def __enter__(self):
        import warnings
        self._warnings = warnings
        warnings.filterwarnings("ignore", category=UserWarning)
        return self

    def __exit__(self, *args):
        self._warnings.resetwarnings()
