"""
QA-tests for SCH-639: strategie mag geen SOLAR_CHARGE tonen bij negatieve
stroomprijzen wanneer de PV-limiter op 0 W staat.

Fix: solar_wh_slot wordt nu geschaald vóór de net_wh-berekening (commit 5659c30).
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import timedelta
import pytest

from strategy import build_plan, SOLAR_CHARGE, NEUTRAL, GRID_CHARGE
from tests.conftest import TEST_START, make_prices, make_consumption, settings

SOLAR_HOUR = 10   # uur met sterk solar-overschot in alle tests
SOLAR_WH   = 3000 # ruim boven 300 Wh consumptie → overschot van 2700 Wh


def _solar(hour=SOLAR_HOUR, wh=SOLAR_WH):
    slot_key = (TEST_START + timedelta(hours=hour)).isoformat()
    return {slot_key: float(wh)}


# ---------------------------------------------------------------------------
# Scenario 1 – negatieve prijs + PV-limiter 0 W → NEUTRAL, nooit SOLAR_CHARGE
# ---------------------------------------------------------------------------

class TestNegativePricePvLimiterZero:
    """Core bug fix: bij negatieve prijs en pv_limiter_min_w=0 geen SOLAR_CHARGE."""

    def _run(self, buy_price=-0.10):
        prices = make_prices(flat=buy_price)
        s = settings(
            pv_limiter_enabled=True,
            pv_limiter_min_w=0,
            pv_limiter_max_w=4000,
            pv_limiter_threshold_ct=0.0,   # trigger bij < 0 ct/kWh
            manual_peak_hours=[],
        )
        return build_plan(prices, _solar(), make_consumption(300.0),
                          bat_soc_now=50.0, settings=s,
                          start_dt=TEST_START, num_slots=24)

    def test_solar_hour_is_not_solar_charge(self):
        """Negatieve prijs: solar_wh_slot→0 → net_wh negatief → niet SOLAR_CHARGE."""
        slots = self._run()
        action = slots[SOLAR_HOUR]["action"]
        assert action != SOLAR_CHARGE, (
            f"BUG aanwezig: slot {SOLAR_HOUR} geeft {action!r} bij negatieve prijs "
            f"met PV-limiter op 0W"
        )

    def test_solar_hour_is_grid_charge(self):
        """Bij negatieve prijs moet altijd GRID_CHARGE worden gekozen (SCH-642)."""
        slots = self._run()
        action = slots[SOLAR_HOUR]["action"]
        assert action == GRID_CHARGE, (
            f"Verwacht GRID_CHARGE maar kreeg {action!r} op slot {SOLAR_HOUR} "
            f"bij negatieve prijs"
        )

    def test_solar_wh_in_slot_is_zero(self):
        """solar_wh in het slot-output moet 0 zijn na scaling."""
        slots = self._run()
        assert slots[SOLAR_HOUR]["solar_wh"] == 0.0, (
            f"solar_wh {slots[SOLAR_HOUR]['solar_wh']} != 0 bij PV-limiter 0W"
        )

    def test_threshold_boundary_just_below(self):
        """Prijs net onder drempel (0 ct/kWh) triggert PV-limiter → geen SOLAR_CHARGE."""
        slots = self._run(buy_price=-0.001)
        assert slots[SOLAR_HOUR]["action"] != SOLAR_CHARGE

    def test_threshold_boundary_at_zero(self):
        """Prijs precies 0: threshold 0.0 ct/kWh, buy_price=0.0 → NIET < threshold → limiter NIET actief."""
        prices = make_prices(flat=0.0)
        s = settings(
            pv_limiter_enabled=True,
            pv_limiter_min_w=0,
            pv_limiter_max_w=4000,
            pv_limiter_threshold_ct=0.0,   # trigger bij prijs < 0.0 €/kWh
            manual_peak_hours=[],
        )
        slots = build_plan(prices, _solar(), make_consumption(300.0),
                           bat_soc_now=50.0, settings=s,
                           start_dt=TEST_START, num_slots=24)
        # Bij prijs == threshold: limiter is NIET actief → SOLAR_CHARGE is toegestaan
        assert slots[SOLAR_HOUR]["action"] == SOLAR_CHARGE, (
            "Bij prijs == threshold mag SOLAR_CHARGE wel"
        )


# ---------------------------------------------------------------------------
# Scenario 2 – positieve prijs met solar-overschot → SOLAR_CHARGE werkt nog
# ---------------------------------------------------------------------------

class TestPositivePriceSolarChargeIntact:
    """Regressie: bij positieve prijs en PV-limiter op max_w werkt SOLAR_CHARGE."""

    def test_positive_price_gives_solar_charge(self):
        prices = make_prices(flat=0.20)
        s = settings(
            pv_limiter_enabled=True,
            pv_limiter_min_w=0,
            pv_limiter_max_w=4000,
            pv_limiter_threshold_ct=0.0,
            manual_peak_hours=[],
        )
        slots = build_plan(prices, _solar(), make_consumption(300.0),
                           bat_soc_now=50.0, settings=s,
                           start_dt=TEST_START, num_slots=24)
        assert slots[SOLAR_HOUR]["action"] == SOLAR_CHARGE, (
            "REGRESSIE: positieve prijs met solar-overschot geeft geen SOLAR_CHARGE meer"
        )

    def test_solar_wh_is_nonzero_on_positive_price(self):
        prices = make_prices(flat=0.20)
        s = settings(
            pv_limiter_enabled=True,
            pv_limiter_min_w=0,
            pv_limiter_max_w=4000,
            pv_limiter_threshold_ct=0.0,
            manual_peak_hours=[],
        )
        slots = build_plan(prices, _solar(), make_consumption(300.0),
                           bat_soc_now=50.0, settings=s,
                           start_dt=TEST_START, num_slots=24)
        assert slots[SOLAR_HOUR]["solar_wh"] > 0, (
            "solar_wh moet > 0 zijn bij positieve prijs (PV-limiter max_w actief)"
        )


# ---------------------------------------------------------------------------
# Scenario 3 – manuele override manual_w=0 → weigert SOLAR_CHARGE
# ---------------------------------------------------------------------------

class TestManualOverrideZero:
    """Bij pv_limiter_manual_override=True en manual_w=0 geen SOLAR_CHARGE."""

    def test_manual_zero_suppresses_solar_charge(self):
        prices = make_prices(flat=0.20)   # positieve prijs zodat alleen manual de reden is
        s = settings(
            pv_limiter_enabled=True,
            pv_limiter_manual_override=True,
            pv_limiter_manual_w=0,
            pv_limiter_max_w=4000,
            pv_limiter_threshold_ct=0.0,
            manual_peak_hours=[],
        )
        slots = build_plan(prices, _solar(), make_consumption(300.0),
                           bat_soc_now=50.0, settings=s,
                           start_dt=TEST_START, num_slots=24)
        assert slots[SOLAR_HOUR]["action"] != SOLAR_CHARGE, (
            "manual_w=0 moet SOLAR_CHARGE blokkeren"
        )
        assert slots[SOLAR_HOUR]["solar_wh"] == 0.0, (
            "solar_wh moet 0 zijn bij manual_w=0"
        )

    def test_manual_nonzero_allows_solar_charge(self):
        """manual_w=2000 W (50 % van max 4000 W): solar_wh halved, overschot nog steeds groot → SOLAR_CHARGE."""
        prices = make_prices(flat=0.20)
        s = settings(
            pv_limiter_enabled=True,
            pv_limiter_manual_override=True,
            pv_limiter_manual_w=2000,
            pv_limiter_max_w=4000,
            pv_limiter_threshold_ct=0.0,
            manual_peak_hours=[],
        )
        slots = build_plan(prices, _solar(), make_consumption(300.0),
                           bat_soc_now=50.0, settings=s,
                           start_dt=TEST_START, num_slots=24)
        # solar_wh_slot = 3000 * (2000/4000) = 1500 Wh; net_wh = 1500 - 300 = 1200 Wh → SOLAR_CHARGE
        assert slots[SOLAR_HOUR]["action"] == SOLAR_CHARGE, (
            "manual_w=2000 W met genoeg overschot moet SOLAR_CHARGE geven"
        )


# ---------------------------------------------------------------------------
# Scenario 4 – PV-limiter uitgeschakeld → gedrag ongewijzigd
# ---------------------------------------------------------------------------

class TestPvLimiterDisabled:
    """Als pv_limiter_enabled=False geldt de PV-limiter-logica nooit."""

    def test_disabled_with_positive_price_solar_charge(self):
        """Uitgeschakeld + positieve prijs → SOLAR_CHARGE."""
        prices = make_prices(flat=0.20)
        s = settings(pv_limiter_enabled=False, manual_peak_hours=[])
        slots = build_plan(prices, _solar(), make_consumption(300.0),
                           bat_soc_now=50.0, settings=s,
                           start_dt=TEST_START, num_slots=24)
        assert slots[SOLAR_HOUR]["action"] == SOLAR_CHARGE

    def test_disabled_with_negative_price_still_solar_charge(self):
        """Uitgeschakeld + negatieve prijs: PV-limiter doet niets, dus SOLAR_CHARGE mag nog."""
        prices = make_prices(flat=-0.10)
        s = settings(pv_limiter_enabled=False, manual_peak_hours=[])
        slots = build_plan(prices, _solar(), make_consumption(300.0),
                           bat_soc_now=50.0, settings=s,
                           start_dt=TEST_START, num_slots=24)
        # Zonder PV-limiter heeft negatieve prijs geen invloed op solar_wh_slot.
        # Bij negatieve prijs wordt normaal GRID_CHARGE gekozen, maar solar_wh_slot is ongemoeid.
        # Beide acties zijn acceptabel; wat NIET mag is dat dit crasht.
        assert slots[SOLAR_HOUR]["solar_wh"] == float(SOLAR_WH), (
            "solar_wh mag niet geschaald worden als PV-limiter uitgeschakeld is"
        )

    def test_disabled_solar_wh_unscaled(self):
        """Uitgeschakeld: solar_wh_slot is exact de ingevoerde waarde."""
        prices = make_prices(flat=0.20)
        s = settings(pv_limiter_enabled=False, manual_peak_hours=[])
        slots = build_plan(prices, _solar(wh=2500), make_consumption(300.0),
                           bat_soc_now=50.0, settings=s,
                           start_dt=TEST_START, num_slots=24)
        assert slots[SOLAR_HOUR]["solar_wh"] == 2500.0
