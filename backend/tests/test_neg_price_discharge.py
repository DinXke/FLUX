"""
Unit tests for the neg_price_discharge feature in strategy.build_plan() — SCH-72.

When neg_price_discharge_enabled=True and a negative (or below-threshold) price
appears within the lookahead window, the algorithm pre-empties the battery so
that the upcoming free/paid charging slot has maximum headroom.

Decision branch (strategy.py):
    elif _upcoming_neg and bat_kwh > bat_min + 0.2:
        action = DISCHARGE   (reason: "Preventief ontladen …")

Priority:
  buy_price < 0  → GRID_CHARGE  (handled BEFORE the _upcoming_neg branch)
  _upcoming_neg  → DISCHARGE
  rest of logic  → unchanged
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import timedelta

from strategy import build_plan, GRID_CHARGE, DISCHARGE, NEUTRAL
from tests.conftest import TEST_START, make_prices, make_consumption, settings


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def slot(slots, idx):
    return slots[idx]


def neg_settings(**overrides):
    """BASE_SETTINGS with neg_price_discharge enabled and no markup."""
    base = settings(
        manual_peak_hours=[],
        neg_price_discharge_enabled=True,
        neg_price_lookahead_h=4,
        neg_price_threshold_ct=0.0,
    )
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Core trigger
# ---------------------------------------------------------------------------

class TestPreventiveDischarge:
    def test_negative_price_within_window_triggers_discharge(self):
        """
        Negative price at hour 3, lookahead=4 → DISCHARGE at hours 0–2.

        range(i+1, i+5) for i=0 covers hours 1–4; hour 3 has -0.05 → DISCHARGE.
        """
        hourly = [0.15, 0.15, 0.15, -0.05] + [0.15] * 44
        prices = make_prices(hourly_prices=hourly)
        cons = make_consumption(300.0)

        slots = build_plan(prices, {}, cons, bat_soc_now=80.0,
                           settings=neg_settings(),
                           start_dt=TEST_START, num_slots=8)
        assert slot(slots, 0)["action"] == DISCHARGE

    def test_discharge_reason_mentions_preventive(self):
        """The DISCHARGE reason string must reference the preventive context."""
        hourly = [0.15, 0.15, 0.15, -0.05] + [0.15] * 44
        prices = make_prices(hourly_prices=hourly)
        cons = make_consumption(300.0)

        slots = build_plan(prices, {}, cons, bat_soc_now=80.0,
                           settings=neg_settings(),
                           start_dt=TEST_START, num_slots=8)
        assert "Preventief" in slot(slots, 0)["reason"] or "negatieve" in slot(slots, 0)["reason"].lower()

    def test_negative_price_slot_itself_is_grid_charge(self):
        """
        At the negative-price slot (buy_price < 0) the algorithm must choose
        GRID_CHARGE (existing branch), not DISCHARGE.
        """
        hourly = [0.15, 0.15, 0.15, -0.05] + [0.15] * 44
        prices = make_prices(hourly_prices=hourly)
        cons = make_consumption(300.0)

        slots = build_plan(prices, {}, cons, bat_soc_now=50.0,
                           settings=neg_settings(),
                           start_dt=TEST_START, num_slots=8)
        assert slot(slots, 3)["action"] == GRID_CHARGE


# ---------------------------------------------------------------------------
# Feature flag
# ---------------------------------------------------------------------------

class TestFeatureFlag:
    def test_disabled_suppresses_preventive_discharge(self):
        """neg_price_discharge_enabled=False → no DISCHARGE before negative price."""
        hourly = [0.15, 0.15, 0.15, -0.05] + [0.15] * 44
        prices = make_prices(hourly_prices=hourly)
        cons = make_consumption(300.0)

        slots = build_plan(prices, {}, cons, bat_soc_now=80.0,
                           settings=neg_settings(neg_price_discharge_enabled=False),
                           start_dt=TEST_START, num_slots=8)
        # Hour 0 must NOT be preventive DISCHARGE
        assert slot(slots, 0)["action"] != DISCHARGE

    def test_enabled_vs_disabled_differ_at_pre_neg_hour(self):
        """Same input, only the flag differs — actions must differ at hour 0."""
        hourly = [0.15, 0.15, 0.15, -0.05] + [0.15] * 44
        prices = make_prices(hourly_prices=hourly)
        cons = make_consumption(300.0)

        s_on  = neg_settings(neg_price_discharge_enabled=True)
        s_off = neg_settings(neg_price_discharge_enabled=False)

        slots_on  = build_plan(prices, {}, cons, bat_soc_now=80.0,
                               settings=s_on, start_dt=TEST_START, num_slots=8)
        slots_off = build_plan(prices, {}, cons, bat_soc_now=80.0,
                               settings=s_off, start_dt=TEST_START, num_slots=8)

        assert slot(slots_on,  0)["action"] == DISCHARGE
        assert slot(slots_off, 0)["action"] != DISCHARGE


# ---------------------------------------------------------------------------
# Lookahead window
# ---------------------------------------------------------------------------

class TestLookaheadWindow:
    def test_negative_price_exactly_at_boundary_triggers(self):
        """
        lookahead_h=4: range(i+1, i+5) covers hours 1–4 inclusive.
        Negative price at hour 4 is within the window → DISCHARGE at hour 0.
        """
        hourly = [0.15] * 4 + [-0.05] + [0.15] * 43
        prices = make_prices(hourly_prices=hourly)
        cons = make_consumption(300.0)

        slots = build_plan(prices, {}, cons, bat_soc_now=80.0,
                           settings=neg_settings(neg_price_lookahead_h=4),
                           start_dt=TEST_START, num_slots=10)
        assert slot(slots, 0)["action"] == DISCHARGE

    def test_negative_price_just_outside_window_no_trigger(self):
        """
        lookahead_h=4: hour 5 is OUTSIDE range(1, 5) → no preventive DISCHARGE.
        """
        hourly = [0.15] * 5 + [-0.05] + [0.15] * 42
        prices = make_prices(hourly_prices=hourly)
        cons = make_consumption(300.0)

        slots = build_plan(prices, {}, cons, bat_soc_now=80.0,
                           settings=neg_settings(neg_price_lookahead_h=4),
                           start_dt=TEST_START, num_slots=10)
        assert slot(slots, 0)["action"] != DISCHARGE

    def test_shorter_lookahead_misses_far_negative_price(self):
        """
        Negative price at hour 4: lookahead_h=2 → range(1,3) misses it → no DISCHARGE.
        lookahead_h=4 → range(1,5) catches it → DISCHARGE.
        """
        hourly = [0.15] * 4 + [-0.05] + [0.15] * 43
        prices = make_prices(hourly_prices=hourly)
        cons = make_consumption(300.0)

        slots_short = build_plan(prices, {}, cons, bat_soc_now=80.0,
                                 settings=neg_settings(neg_price_lookahead_h=2),
                                 start_dt=TEST_START, num_slots=10)
        slots_long  = build_plan(prices, {}, cons, bat_soc_now=80.0,
                                 settings=neg_settings(neg_price_lookahead_h=4),
                                 start_dt=TEST_START, num_slots=10)

        assert slot(slots_short, 0)["action"] != DISCHARGE
        assert slot(slots_long,  0)["action"] == DISCHARGE


# ---------------------------------------------------------------------------
# Threshold (neg_price_threshold_ct)
# ---------------------------------------------------------------------------

class TestThreshold:
    def test_default_threshold_ignores_low_positive_prices(self):
        """
        Default threshold = 0 ct → only prices < 0 count.
        Low positive price (3 ct/kWh) should NOT trigger preventive discharge.
        """
        hourly = [0.15, 0.15, 0.15, 0.03] + [0.15] * 44   # 3 ct at hour 3
        prices = make_prices(hourly_prices=hourly)
        cons = make_consumption(300.0)

        slots = build_plan(prices, {}, cons, bat_soc_now=80.0,
                           settings=neg_settings(neg_price_threshold_ct=0.0),
                           start_dt=TEST_START, num_slots=8)
        assert slot(slots, 0)["action"] != DISCHARGE

    def test_positive_threshold_triggers_on_cheap_price(self):
        """
        neg_price_threshold_ct=5 ct → prices < 5 ct count as "negative".
        Price of 3 ct at hour 3 is below 5 ct → preventive DISCHARGE at hour 0.
        """
        hourly = [0.15, 0.15, 0.15, 0.03] + [0.15] * 44   # 3 ct at hour 3
        prices = make_prices(hourly_prices=hourly)
        cons = make_consumption(300.0)

        slots = build_plan(prices, {}, cons, bat_soc_now=80.0,
                           settings=neg_settings(neg_price_threshold_ct=5.0),
                           start_dt=TEST_START, num_slots=8)
        assert slot(slots, 0)["action"] == DISCHARGE

    def test_threshold_not_triggered_when_current_price_below_threshold(self):
        """
        The lookahead only fires when buy_price > neg_dis_thresh.
        If current hour is also below threshold, skip the lookahead entirely
        (it falls through to the buy_price < 0 / grid_charge branch instead).
        """
        # current hour 0 = 0.02 (< 5 ct threshold), hour 2 = -0.05
        hourly = [0.02, 0.15, -0.05] + [0.15] * 45
        prices = make_prices(hourly_prices=hourly)
        cons = make_consumption(300.0)

        # With threshold=5ct: buy_price=0.02 is NOT > 0.05 → lookahead skipped
        slots = build_plan(prices, {}, cons, bat_soc_now=80.0,
                           settings=neg_settings(neg_price_threshold_ct=5.0),
                           start_dt=TEST_START, num_slots=6)
        # Hour 0 at 2ct: since it's not > threshold, no preventive discharge logic
        assert slot(slots, 0)["action"] != DISCHARGE


# ---------------------------------------------------------------------------
# Battery state guards
# ---------------------------------------------------------------------------

class TestBatteryGuards:
    def test_no_preventive_discharge_at_minimum_soc(self):
        """Battery at min_reserve_soc → discharge_possible ≈ 0 → NEUTRAL."""
        hourly = [0.15, 0.15, 0.15, -0.05] + [0.15] * 44
        prices = make_prices(hourly_prices=hourly)
        cons = make_consumption(300.0)

        slots = build_plan(prices, {}, cons, bat_soc_now=10.0,
                           settings=neg_settings(min_reserve_soc=10),
                           start_dt=TEST_START, num_slots=8)
        assert slot(slots, 0)["action"] != DISCHARGE

    def test_preventive_discharge_reduces_soc(self):
        """SOC must fall when preventive DISCHARGE fires."""
        hourly = [0.15, 0.15, 0.15, -0.05] + [0.15] * 44
        prices = make_prices(hourly_prices=hourly)
        cons = make_consumption(500.0)

        slots = build_plan(prices, {}, cons, bat_soc_now=80.0,
                           settings=neg_settings(),
                           start_dt=TEST_START, num_slots=8)
        ds = slot(slots, 0)
        assert ds["action"] == DISCHARGE
        assert ds["soc_end"] < ds["soc_start"]
