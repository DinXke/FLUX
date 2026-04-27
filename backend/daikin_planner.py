"""
Daikin smart planning engine.
Plans heat pump setpoints based on energy prices, solar forecast, and comfort deadlines.
"""
import logging
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)


def build_daikin_plan(prices: list, solar_forecast: dict, devices_cfg: dict, now: datetime) -> dict:
    """
    Build hourly setpoint plan for Daikin devices over the next 24 hours.

    Args:
        prices: List of dicts with 'from' (ISO str) and 'marketPrice' (float in €/MWh)
        solar_forecast: Dict with structure {"{date}": {"hourly": {hour: {"watt_hours_period": W}}}
        devices_cfg: Dict of {device_id: {comfort_setpoint, buffer_setpoint, min_setpoint, max_setpoint}}
        now: Current datetime with timezone

    Returns:
        Dict {device_id: [{"hour_iso": str, "setpoint": float, "reason": str}]}
    """
    plan = {}

    if not prices or not devices_cfg:
        return plan

    # Build price lookup: {hour_iso: market_price}
    price_map = {}
    for entry in prices:
        hour_iso = entry.get("from")
        if hour_iso:
            price_map[hour_iso] = entry.get("marketPrice", 0)

    # Parse solar forecast: {date: {hourly: {hour: {watt_hours_period: W}}}}
    # Build map for (date, hour_of_day) to handle timezone-aware lookups
    solar_by_date_hour = {}
    for date_key, date_data in solar_forecast.items():
        hourly = date_data.get("hourly", {})
        for hour_key, hour_data in hourly.items():
            hour_int = int(hour_key)
            solar_by_date_hour[(date_key, hour_int)] = hour_data.get("watt_hours_period", 0)

    # For each device, build 24-hour plan
    for device_id, cfg in devices_cfg.items():
        if not cfg.get("enabled", True):
            continue

        plan[device_id] = []
        comfort_setpoint = cfg.get("comfort_setpoint", 21.0)
        buffer_setpoint = cfg.get("buffer_setpoint", 25.0)
        min_setpoint = cfg.get("min_setpoint", 16.0)
        max_setpoint = cfg.get("max_setpoint", 28.0)

        # Generate 24 hours starting from now
        for i in range(24):
            hour_time = now + timedelta(hours=i)
            hour_iso = hour_time.isoformat(timespec="seconds")

            # Determine setpoint
            market_price = price_map.get(hour_iso, 0)
            # Look up solar by date and hour of day
            date_key = hour_time.date().isoformat()
            solar_watts = solar_by_date_hour.get((date_key, hour_time.hour), 0)

            reason = "comfort"
            setpoint = comfort_setpoint

            # Negative price takes priority
            if market_price < 0:
                setpoint = buffer_setpoint
                reason = "negative_price"
            # Then check solar surplus
            elif solar_watts > cfg.get("solar_surplus_threshold_w", 500):
                setpoint = buffer_setpoint
                reason = "solar_surplus"

            # Clamp to min/max
            setpoint = max(min_setpoint, min(max_setpoint, setpoint))

            plan[device_id].append({
                "hour_iso": hour_iso,
                "setpoint": setpoint,
                "reason": reason
            })

    return plan


def compute_deadline_slots(
    deadline_hour: int,
    min_runtime_hours: int,
    prices: list,
    now: datetime
) -> set:
    """
    Find the cheapest hours to heat before a deadline.

    Args:
        deadline_hour: Target hour (0-23) to be warm by
        min_runtime_hours: Minimum heating hours needed
        prices: List of {from, marketPrice}
        now: Current datetime

    Returns:
        Set of ISO hour strings (e.g. "2026-04-27T14:00:00")
    """
    if min_runtime_hours <= 0 or deadline_hour < 0 or deadline_hour > 23:
        return set()

    # Build price lookup for the next 24-48 hours
    price_slots = []
    for i in range(48):
        slot_time = now + timedelta(hours=i)
        slot_hour = slot_time.hour
        slot_iso = slot_time.isoformat(timespec="seconds")

        # Find price for this slot
        market_price = None
        for entry in prices:
            if entry.get("from") == slot_iso:
                market_price = entry.get("marketPrice", 0)
                break

        if market_price is None:
            continue

        # Check if this slot is before or at deadline
        if slot_hour <= deadline_hour:
            price_slots.append((slot_iso, market_price, slot_hour))

    if not price_slots:
        return set()

    # Sort by price ascending, take the cheapest min_runtime_hours
    price_slots.sort(key=lambda x: x[1])
    selected = price_slots[:min(min_runtime_hours, len(price_slots))]

    return {slot[0] for slot in selected}


def apply_daikin_plan(
    plan: dict,
    current_hour_iso: str,
    session: dict,
    data_dir: str,
    client_id: str,
    daikin_onecta_module
) -> dict:
    """
    Apply the current hour of the plan to Daikin devices.

    Args:
        plan: Output from build_daikin_plan()
        current_hour_iso: Current hour ISO string to match
        session: Daikin OAuth2 session
        data_dir: Path to data directory
        client_id: Daikin OAuth2 client ID
        daikin_onecta_module: daikin_onecta module reference

    Returns:
        Dict with applied changes: {device_id: {old_setpoint, new_setpoint, reason}}
    """
    applied = {}

    for device_id, slots in plan.items():
        # Find the slot matching current hour
        current_slot = None
        for slot in slots:
            if slot["hour_iso"] == current_hour_iso:
                current_slot = slot
                break

        if not current_slot:
            continue

        setpoint = current_slot["setpoint"]
        reason = current_slot["reason"]

        try:
            log.info(
                "Daikin planner: applying %s setpoint %.1f°C (reason: %s)",
                device_id, setpoint, reason
            )
            daikin_onecta_module.set_daikin_temperature(
                session, data_dir, client_id, device_id, setpoint
            )
            applied[device_id] = {
                "setpoint": setpoint,
                "reason": reason,
                "status": "ok"
            }
        except Exception as exc:
            log.error("Daikin planner: failed to set %s: %s", device_id, exc)
            applied[device_id] = {
                "setpoint": setpoint,
                "reason": reason,
                "status": "error",
                "error": str(exc)
            }

    return applied
