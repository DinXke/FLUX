"""Tests for Daikin smart planning engine."""
import pytest
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from daikin_planner import build_daikin_plan, compute_deadline_slots, apply_daikin_plan


@pytest.fixture
def sample_now():
    """Current time: 2026-04-27 10:00:00 UTC"""
    return datetime(2026, 4, 27, 10, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def sample_prices(sample_now):
    """24-hour price forecast starting from sample_now."""
    prices = []
    for i in range(24):
        hour_time = sample_now + timedelta(hours=i)
        hour_iso = hour_time.isoformat(timespec="seconds")
        # Prices vary: negative at night, high during day, cheap in evening
        if i < 8:
            market_price = -10.0  # Night: negative
        elif i < 12:
            market_price = 50.0  # Morning: high
        elif i < 15:
            market_price = 100.0  # Afternoon peak
        else:
            market_price = 20.0  # Evening: cheap
        prices.append({"from": hour_iso, "marketPrice": market_price})
    return prices


@pytest.fixture
def sample_solar_forecast(sample_now):
    """Solar forecast: good production from 8-18 for today and tomorrow."""
    forecast = {}
    # Add forecast for today and tomorrow to handle 24-hour plan that spans both days
    for day_offset in range(2):
        date = sample_now.date() + timedelta(days=day_offset)
        date_key = date.isoformat()
        hourly = {}
        for hour in range(24):
            if 8 <= hour <= 18:
                watt_hours = 800  # Good solar
            else:
                watt_hours = 50   # Night/twilight
            hourly[str(hour)] = {"watt_hours_period": watt_hours}
        forecast[date_key] = {"hourly": hourly}
    return forecast


@pytest.fixture
def sample_devices_cfg():
    """Sample device configuration."""
    return {
        "device_1": {
            "enabled": True,
            "comfort_setpoint": 21.0,
            "buffer_setpoint": 25.0,
            "min_setpoint": 16.0,
            "max_setpoint": 28.0,
            "solar_surplus_threshold_w": 500,
        }
    }


def test_build_plan_negative_price(sample_now, sample_prices, sample_solar_forecast, sample_devices_cfg):
    """Negative price hours should get buffer_setpoint."""
    plan = build_daikin_plan(sample_prices, sample_solar_forecast, sample_devices_cfg, sample_now)

    assert "device_1" in plan
    device_plan = plan["device_1"]
    assert len(device_plan) == 24

    # First 8 hours are negative price → should get buffer_setpoint (25.0)
    for i in range(8):
        slot = device_plan[i]
        assert slot["reason"] == "negative_price"
        assert slot["setpoint"] == 25.0


def test_build_plan_solar_surplus(sample_now, sample_prices, sample_solar_forecast, sample_devices_cfg):
    """Solar surplus hours should get buffer_setpoint."""
    # Modify prices to be non-negative
    for price in sample_prices:
        price["marketPrice"] = 30.0

    # Solar is high 8-18 (8am-6pm)
    # sample_now is 10:00am, so indices 0-8 correspond to hours 10-18 (10am-6pm)
    plan = build_daikin_plan(sample_prices, sample_solar_forecast, sample_devices_cfg, sample_now)

    device_plan = plan["device_1"]

    # Indices 0-8 (hours 10-18 on first day) should have solar_surplus reason and buffer_setpoint
    for i in range(9):  # indices 0-8
        slot = device_plan[i]
        assert slot["reason"] == "solar_surplus", f"Index {i} should have solar_surplus but got {slot['reason']}"
        assert slot["setpoint"] == 25.0


def test_build_plan_comfort(sample_now, sample_prices, sample_solar_forecast, sample_devices_cfg):
    """Non-negative, non-surplus hours should get comfort_setpoint."""
    # Modify prices: no negatives, low solar
    for price in sample_prices:
        price["marketPrice"] = 50.0

    # No solar
    for date_data in sample_solar_forecast.values():
        for hour_data in date_data.get("hourly", {}).values():
            hour_data["watt_hours_period"] = 0

    plan = build_daikin_plan(sample_prices, sample_solar_forecast, sample_devices_cfg, sample_now)

    device_plan = plan["device_1"]

    # All hours should have comfort reason and comfort_setpoint
    for slot in device_plan:
        assert slot["reason"] == "comfort"
        assert slot["setpoint"] == 21.0


def test_build_plan_respects_min_max(sample_now, sample_prices, sample_solar_forecast):
    """Setpoints should be clamped to min/max."""
    devices_cfg = {
        "device_1": {
            "enabled": True,
            "comfort_setpoint": 15.0,  # Below min
            "buffer_setpoint": 30.0,   # Above max
            "min_setpoint": 16.0,
            "max_setpoint": 28.0,
            "solar_surplus_threshold_w": 500,
        }
    }

    plan = build_daikin_plan(sample_prices, sample_solar_forecast, devices_cfg, sample_now)
    device_plan = plan["device_1"]

    # All comfort setpoints should be clamped to 16.0
    # All buffer setpoints should be clamped to 28.0
    for slot in device_plan:
        assert slot["setpoint"] >= 16.0
        assert slot["setpoint"] <= 28.0


def test_build_plan_disabled_device(sample_now, sample_prices, sample_solar_forecast):
    """Disabled devices should not appear in plan."""
    devices_cfg = {
        "device_1": {
            "enabled": False,
            "comfort_setpoint": 21.0,
            "buffer_setpoint": 25.0,
            "min_setpoint": 16.0,
            "max_setpoint": 28.0,
        }
    }

    plan = build_daikin_plan(sample_prices, sample_solar_forecast, devices_cfg, sample_now)
    assert "device_1" not in plan


def test_deadline_slots_basic(sample_now, sample_prices):
    """Find cheapest 2 hours before 7am."""
    # Set deadline to 7am (hour=7)
    deadline_hour = 7
    min_runtime = 2

    slots = compute_deadline_slots(deadline_hour, min_runtime, sample_prices, sample_now)

    # Should return a set of ISO strings
    assert isinstance(slots, set)
    assert len(slots) <= min_runtime


def test_deadline_slots_not_enough_hours(sample_now, sample_prices):
    """If fewer available hours than min_runtime, use what's available."""
    deadline_hour = 1
    min_runtime = 100  # More than available

    slots = compute_deadline_slots(deadline_hour, min_runtime, sample_prices, sample_now)

    # Should return only available slots
    assert isinstance(slots, set)
    assert len(slots) > 0
    assert len(slots) <= len(sample_prices)


def test_deadline_slots_invalid_inputs(sample_now, sample_prices):
    """Invalid inputs should return empty set."""
    # Negative runtime
    slots = compute_deadline_slots(7, -1, sample_prices, sample_now)
    assert slots == set()

    # Invalid deadline hour
    slots = compute_deadline_slots(25, 2, sample_prices, sample_now)
    assert slots == set()


def test_build_plan_empty_inputs(sample_now):
    """Empty inputs should return empty plan."""
    assert build_daikin_plan([], {}, {}, sample_now) == {}
    assert build_daikin_plan([{"from": "2026-04-27T10:00:00", "marketPrice": 50}], {}, {}, sample_now) == {}


def test_apply_daikin_plan_mock(sample_now, sample_devices_cfg):
    """Test apply_daikin_plan with a mock module."""
    plan = {
        "device_1": [
            {
                "hour_iso": sample_now.isoformat(timespec="seconds"),
                "setpoint": 25.0,
                "reason": "negative_price"
            }
        ]
    }

    # Mock daikin_onecta module
    class MockDaikin:
        def set_daikin_temperature(self, session, data_dir, client_id, client_secret, device_id, setpoint):
            return {"ok": True}

    mock_module = MockDaikin()
    applied = apply_daikin_plan(
        plan,
        sample_now.isoformat(timespec="seconds"),
        {},
        "/tmp",
        "test_id",
        "test_secret",
        mock_module
    )

    assert "device_1" in applied
    assert applied["device_1"]["setpoint"] == 25.0
    assert applied["device_1"]["status"] == "ok"
