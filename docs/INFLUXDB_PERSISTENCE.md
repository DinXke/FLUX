# InfluxDB Data Persistence — FLUX SCH-795

## Overview

FLUX persists energy system data to InfluxDB v2 for time-series analysis, forecasting, and historical auditing. This document describes all measurements and fields.

## Measurements

### 1. `energy_flow` (30-second intervals)

Real-time energy flow data collected from all configured sources.

**Fields:**
- `solar_w` (float): Solar array output power (Watts)
- `net_w` (float): Grid power flow, positive=import (Watts)
- `bat_w` (float): Battery power, positive=discharge (Watts)
- `bat_soc` (float): Battery state of charge (0–100 %)
- `house_w` (float): Net household consumption = bat_w + net_w + solar_w - ev_w
- `ev_w` (float): EV charger load (Watts)
- `voltage_l1`, `voltage_l2`, `voltage_l3` (float): Grid line voltages (Volts)
- `net_import_kwh_total` (float): Cumulative grid import energy (kWh)
- `net_export_kwh_total` (float): Cumulative grid export energy (kWh)

**Tags:**
- `source` (string): "marstek" (always)

**Sources:** ESPHome, HomeWizard P1, Home Assistant, flow_cfg.json resolution

---

### 2. `sma_inverter` (30-second intervals, when SMA reader enabled)

SMA Sunny Boy inverter telemetry via Modbus TCP.

**Fields:**
- `pac_w` (float): AC output power (Watts)
- `e_day_wh` (float): Today's energy generation (Wh)
- `e_total_wh` (float): Lifetime energy generation (Wh)
- `grid_v` (float): Grid voltage (Volts)
- `freq_hz` (float): Grid frequency (Hz)
- `dc_power_w` (float): DC input power (Watts)
- `dc_voltage_v` (float): DC input voltage (Volts)

**Tags:**
- `status` (string): Optional inverter status (e.g., "OK", "Warning")

**Config:** `strategy_settings.json` — `sma_reader_*` options

---

### 3. `strategy_slot` (48 hourly records, updated every 30 seconds)

Charging strategy plan forecast: one record per hour for 48 hours ahead.

**Fields:**
- `price_eur_kwh` (float): Electricity price including all taxes/markup (€/kWh)
- `solar_wh` (float): Forecasted solar generation this hour (Wh)
- `consumption_wh` (float): Expected household consumption (Wh)
- `net_wh` (float): Net energy this hour = solar_wh - consumption_wh (Wh)
- `charge_kwh` (float): Recommended grid charge for this hour (kWh)
- `discharge_kwh` (float): Recommended battery discharge (kWh)
- `soc_start` (float): Predicted battery SOC at hour start (%)
- `soc_end` (float): Predicted battery SOC at hour end (%)
- `pv_limit_w` (float): PV curtailment setpoint if applicable (Watts)

**Tags:**
- `action` (string): Recommended action — one of:
  - `GRID_CHARGE` — buy cheap grid electricity
  - `SOLAR_CHARGE` — charge from solar production
  - `DISCHARGE` — use battery to avoid expensive grid draw
  - `SAVE` — hold charge for upcoming expensive hours
  - `NEUTRAL` — no special action needed
- `is_peak` (string): "true" if this hour is a peak-consumption hour
- `is_past` (string): "true" if this hour is in the past (historical)

**Source:** `strategy.py` — `build_plan()` function

**Use cases:**
- Audit strategy efficacy: compare planned vs actual outcomes
- Forecast accuracy: overlay actual generation vs prediction
- ML training: use plan+actuals as labeled dataset
- Grafana dashboards: visualize charging strategy decisions over time

---

### 4. `solar_forecast` (48 hourly records, updated every 30 seconds)

Hourly solar generation forecast from Forecast.Solar.

**Fields:**
- `forecasted_wh` (float): Expected solar generation this hour (Wh)

**Tags:**
- None (solar_forecast is simple point-in-time forecast)

**Source:** Forecast.Solar API (https://forecast.solar/api/estimate/)

**Backfill:** `actual_wh` field can be backfilled using `energy_flow.solar_w` data to compute accuracy

**Use cases:**
- Forecast accuracy trending
- Provider comparison (if multiple forecasters added)
- Price correlations: solar spikes → lower prices
- Seasonal forecasting improvements

---

### 5. `anomaly_alert` (as detected)

System health alerts: stale sensors, power anomalies, inverter faults.

**Fields:**
- `description` (string): Human-readable alert text

**Tags:**
- `type` (string):
  - `stale_sensor` — data hasn't arrived in >1 hour
  - `power_spike` — unusual power behavior detected
  - `inverter_fault` — SMA inverter reports a fault condition
- `sensor` (string): Sensor name (for stale_sensor, power_spike)
- `inverter` (string): Inverter name (for inverter_fault)

**Source:** `anomaly_detector.py` — runs every 10 minutes

**Use cases:**
- System diagnostics: when did sensor X stop reporting?
- Maintenance: track inverter fault history
- Reliability: SLA uptime metrics

---

## Data Flow

```
┌─ ESPHome SSE          ─┐
├─ HomeWizard Local API  ├─ _influx_context() ─┐
├─ Home Assistant API    ─┤                      ├─ influx_writer.py ─ InfluxDB
├─ Strategy compute      ─┤                      │
├─ Forecast.Solar        ─┤                      │
└─ Anomaly detector      ─┘                      │
                                                  └─ write every 30s
                                           (async background thread)
```

### Context Collection (`app.py`)

The `_influx_context()` function runs on **demand** (called every 30 seconds by the background writer thread):

1. Load device configs (ESPHome, HomeWizard, HA)
2. Poll all active devices
3. Fetch latest strategy plan from `_plan_cache`
4. Fetch latest solar forecast from `_forecast_cache`
5. Load latest anomalies from `_anomalies.json`
6. Return dict to writer

### Write (`influx_writer.py`)

The `_collect_and_write()` function:

1. Receives context dict
2. Resolves flow_cfg slots → numeric values
3. Writes `energy_flow` measurement
4. Writes `sma_inverter` measurement (if available)
5. Writes 48 × `strategy_slot` records
6. Writes 48 × `solar_forecast` records
7. Writes `anomaly_alert` records (only if anomalies detected)

All writes happen in a **single batch** for efficiency. If InfluxDB is unavailable, the cycle is skipped (no backlog queue).

---

## Configuration

**Environment Variables:**
```bash
INFLUX_URL=http://localhost:8086          # InfluxDB 2.x API endpoint
INFLUX_TOKEN=your-token                   # API token with write permissions
INFLUX_ORG=flux                           # Organization name
INFLUX_BUCKET=energy                      # Bucket name
```

**Strategy Settings** (`strategy_settings.json`):
- `price_source`: "entsoe" or "frank" — determines price_eur_kwh
- All SMA reader settings control whether sma_inverter is written

**Flow Config** (`flow_cfg.json`):
- Determines which sensors are polled for energy_flow

---

## Query Examples

### Strategy Efficacy

Compare planned discharge to actual discharge for a day:
```flux
from(bucket: "energy")
  |> range(start: 2026-04-25T00:00:00Z, stop: 2026-04-26T00:00:00Z)
  |> filter(fn: (r) => r._measurement == "strategy_slot" or r._measurement == "energy_flow")
  |> pivot(rowKey:["_time"], columnKey: ["_measurement", "_field"], valueColumn: "_value")
  |> map(fn: (r) => ({
      time: r._time,
      planned_discharge: r.strategy_slot_discharge_kwh,
      actual_discharge: r.energy_flow_bat_w / 1000.0
    }))
```

### Forecast Accuracy

Solar forecast vs actual (requires backfill or manual computation):
```flux
from(bucket: "energy")
  |> range(start: -7d)
  |> filter(fn: (r) => r._measurement == "solar_forecast")
  |> aggregateWindow(every: 1d, fn: sum)
```

### Anomaly Timeline

When did sensors go stale?
```flux
from(bucket: "energy")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "anomaly_alert" and r.type == "stale_sensor")
  |> group(columns: ["sensor"])
```

---

## Storage Considerations

### Data Retention

With 30-second intervals:
- `energy_flow`: 288 points/day × 365 = **105K points/year**
- `strategy_slot`: 48 points × 288 cycles/day × 365 = **5M points/year**
- `solar_forecast`: same as strategy
- `anomaly_alert`: sparse (typically <10 alerts/day)

**Total ~10M points/year** at default retention (14 days = ~400K points in-DB at any time).

### Disk Impact

InfluxDB 2.x compression: ~1–2 bytes per field value.
**Expected disk use: <10 MB/month** for the energy bucket.

---

## Troubleshooting

### "InfluxDB not available" in logs

The writer logs a warning but continues. Check:
1. `INFLUX_URL` is correct and InfluxDB is running
2. `INFLUX_TOKEN` is valid (test with `influx write`)
3. Bucket exists: `influx bucket list --org flux`

### No data in InfluxDB

1. Verify context returns non-empty dict: check logs for `_influx_context errors`
2. Verify writer thread is running: grep for `"InfluxDB background writer started"`
3. Check for write errors: grep `"InfluxDB write error"`

### Strategy slots not appearing

1. Ensure strategy plan is computed: `/api/strategy/plan` should return data
2. Verify `_plan_cache.get("slots")` is populated
3. Check write logs: `"InfluxDB strategy slots write OK"`

---

## Future Enhancements (Post-SCH-795)

1. **Thermal data** (`daikin_thermal`, `bosch_thermal`): room temperature, setpoints, heating state
2. **Electricity prices** (`electricity_prices`): historical price records for analysis
3. **Consumption profile** (`consumption_profile`): hourly baseline for auditing
4. **RTE measurement** (`battery_efficiency`): measured round-trip efficiency over time
5. **PV limiter feedback** (`pv_curtailment_actual`): what the inverter actually did vs plan

---

## Related Code

- **Writer loop:** `app.py` line 6578 — `start_background_writer()`
- **Context function:** `app.py` line 4468 — `def _influx_context()`
- **Write logic:** `backend/influx_writer.py` line 222 — `def _collect_and_write()`
- **Strategy plan:** `backend/strategy.py` line 266 — `def build_plan()`
- **Anomaly detection:** `backend/anomaly_detector.py` — full file

---

*Document version: 1.0 (SCH-795)*  
*Last updated: 2026-04-26*
