# FLUX Features & Configuration Guide

## Strategy Engine

### Rule-Based Strategy (Deterministic)

The rule-based engine uses a transparent, auditable algorithm:

1. **Peak Hour Detection** — Analyzes 32 days of consumption history to identify peak demand hours
2. **Break-even Calculation** — Per-hour: `buy_price / RTE + depreciation_cost`
3. **Lookahead Windows:**
   - **8-hour window** — Find cheapest charging opportunity
   - **16-hour window** — Find highest-price discharge slots
4. **Configurable Thresholds:**
   - `min_spread_eur_kwh` — Minimum price difference to trigger grid charge (default: €0.05)
   - `min_reserve_soc` — Never discharge below this level (default: 15%)
   - `max_charge_soc` — Never charge above this level (default: 95%)
   - `max_charge_power_kw` — Maximum grid charging power (default: 3.0 kW)

**Best for:** Predictable behavior, low computational cost, no cloud dependency

### Claude AI Strategy (Adaptive)

Uses Anthropic Claude as an intelligent planning agent. Each planning run:

1. **Input Context:**
   - 48-hour all-in prices (with per-slot break-even)
   - 48-hour solar forecast
   - 32-day historical price patterns (P25/P75/avg per weekday/hour)
   - 32-day historical battery SOC profile
   - 30-day plan-vs-actual accuracy statistics
   - Current battery SOC and constraints

2. **3-Pass Global Optimization:**
   - **Pass 1:** Identify best 3-4 price windows for grid charging and discharging
   - **Pass 2:** Simulate SOC forward through 48 hours with planned actions
   - **Pass 3:** Resolve conflicts (discharge when too low, charge when too full)

3. **Self-Learning:** After ~1-2 weeks, Claude receives:
   - Solar forecast bias ("forecast 15% too optimistic on cloudy days → plan grid_charge backup")
   - Consumption patterns ("Monday 07:00 average SOC 25% → grid_charge Sunday night")
   - Plan accuracy trends (helps predict when to be conservative)

4. **Cost:** Claude Haiku: ~€0.002-0.005 per planning run (daily when prices change)

**Supported Models:**
- Claude Haiku 4.5 (fastest, cheapest)
- Claude Sonnet 4.6 (balanced)
- Claude Opus 4.7 (most capable)

**Best for:** Complex price patterns, seasonal variations, maximized savings

### OpenAI Strategy (Alternative)

Requires OpenAI API key. Supported models:
- GPT-4o (most capable)
- GPT-4o-mini (balanced cost/performance)
- o1, o3 (reasoning models, experimental)

Configure via Settings or environment:
```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

### Auto Mode

Automatically selects Claude or OpenAI based on price complexity:
- **Simple patterns:** Claude Haiku (cheapest)
- **Complex patterns:** Sonnet 4.6 or GPT-4o
- **Baseline fallback:** Rule-based (if both APIs fail)

## Energy Price Integration

### Frank Energie (Belgium/Netherlands)

Real-time all-in consumer prices (market + taxes + surcharges):

1. **OAuth Setup:**
   - Settings → Tariffs → "Connect Frank Energie"
   - Authorizes FLUX to read your electricity rates
   - Token auto-refreshes every 24 hours

2. **Data Returned:**
   - Current hour price (€/kWh)
   - 48-hour forecast
   - Historical 32-day rolling average

3. **Historical Context:** Consumption analysis via `periodUsageAndCosts` GraphQL query

### ENTSO-E (Europe-wide)

Free day-ahead electricity prices from transparent platform:

1. **Setup:**
   - Register at https://transparency.entsoe.eu
   - Generate API key in user settings
   - Settings → Tariffs → ENTSO-E section

2. **Countries Supported:** BE, NL, DE, FR, AT, CH, IT, ES, PT, SE, DK, NO, GB, PL, CZ, HU, RO, HR, etc.

3. **Data:**
   - Day-ahead market prices (published ~14:30 for next day)
   - Hourly resolution
   - No consumption data (use Frank Energie for that)

4. **Net Markup:** Add local grid/balancing costs via `nettarief_opslag` (default: €0.133/kWh)

## Solar Forecast Integration

### Forecast.solar

Free solar production forecast:

1. **Configuration:**
   - Settings → Solar → Forecast.solar
   - Latitude/Longitude (find via Google Maps)
   - System capacity (kW): Total installed solar panels
   - Roof angle (0-90°)
   - Roof direction: 0=North, 90=East, 180=South, 270=West
   - Losses (typically 10-15% for soiling, wiring, inverter efficiency)

2. **Output:**
   - 48-hour forecast at 15-minute intervals
   - Per-hour aggregated values in strategy

3. **Actual vs Forecast:**
   - Compare realized production (via InfluxDB or HA) against forecast
   - Overlay on Forecast page
   - Used by Claude to calibrate future forecasts

### Manual Entity Configuration

If Forecast.solar doesn't work for your setup, use a Home Assistant entity:

Settings → Solar → "Actual production source" → Select HA sensor

## Anomaly Detection *(Phase 3)*

Monitors battery, inverter, and sensor health:

### Sensor Staleness Detection
- Alerts if a configured data source hasn't updated > 1 hour
- Common causes:
  - ESPHome device offline or restarted
  - InfluxDB connection lost
  - HA entity missing
  - Home Assistant down

### Inverter Fault Detection
- Monitors SMA Sunny Boy Modbus registers for error codes
- Automatically disables automation if inverter is in:
  - AC Bypass mode
  - Fault state
  - GFDI (ground fault) triggered

### Power Spike Detection
- Identifies unusual consumption/production spikes
- Common causes:
  - Heater/cooler suddenly turning on
  - EV charger activated
  - Large appliance startup (washing machine, oven, etc.)

### Telegram Alerts
Configure notifications for anomalies:
- Event type: `esphome_failed`, `inverter_fault`, `sensor_stale`, `unusual_spike`
- Frequency: Per occurrence, or suppress duplicates within 1 hour
- User acknowledgment: Some alerts support Telegram approval (within 30 min)

## ML Consumption Forecast *(Phase 3)*

Uses Facebook Prophet to predict household consumption:

### Training Phase
- **Duration:** Requires 32+ days of historical InfluxDB data
- **Granularity:** Per-hour consumption aggregates
- **Seasonality:** Automatically detects:
  - Weekday patterns (Monday different from Saturday)
  - Seasonal trends (winter vs summer)

### Forecast Output
- **Horizon:** 7 days ahead, hourly resolution
- **Confidence intervals:** 80% and 95% bands around prediction
- **Retraining:** Daily after new data arrives

### Integration with Strategy
- Claude receives 7-day consumption forecast alongside solar/price data
- Can anticipate peak consumption hours
- Particularly useful for grid-charging decisions (ensure capacity for upcoming peaks)

## Telegram Notifications

Real-time battery status and alerts via Telegram:

### Setup
1. Settings → Notifications → Telegram
2. Get your Chat ID: Message @userinfobot to BotFather
3. Enter Chat ID and CommunicationAgent URL (usually `http://localhost:3001`)

### Notification Types

| Event | Condition | Customizable? |
|-------|-----------|---------------|
| `plan_ready` | New 48-hour plan calculated | On/Off toggle |
| `grid_charge_opportunity` | Price ≤ threshold OR SOC ≤ limit | Yes (price €/kWh, SOC %) |
| `esphome_failed` | Battery device offline > 1 min | On/Off toggle |
| `inverter_fault` | SMA error code detected | On/Off toggle |
| `daily_summary` | Each day at 20:00 | On/Off toggle |

## Performance Metrics

### Round-Trip Efficiency (RTE)

Calculated from actual battery charge/discharge cycles:

- **Manual:** Settings → Strategy → RTE (default: 0.92)
- **Auto-measured:** Module `rte_calculator.py` analyzes 30 days of InfluxDB data
  - Integrates battery power (W) to get charge/discharge kWh
  - Formula: RTE = discharge_kwh / charge_kwh
  - Confidence levels: High (≥50 kWh), Medium (≥15 kWh), Low, Insufficient

### Profit Analysis

Compare energy costs with vs without automation:

**With Automation:** Actual costs (Frank Energie historical prices × measured net import)
**Without Automation:** Simulated anti-feed scenario (never charge, always export excess)
**Savings:** Daily + weekly + monthly + yearly extrapolation

Accessible via Profit dashboard (💰 tab).

## Data Persistence

Configuration and historical data stored in:

### Add-on Mode
- **Location:** `/data/` (HA /data partition)
- **Persistence:** Survives add-on restart

### Docker Mode
- **Location:** Docker volumes (`flux_flux_data`, `flux_influxdb_data`)
- **Persistence:** Survives container restart
- **Backup:** `docker-compose down -v` removes; backup volumes before upgrading

### Key Files

| File | Purpose |
|------|---------|
| `strategy_settings.json` | All user settings (battery specs, API keys, thresholds) |
| `automation.json` | Current battery command, manual overrides, PV limiter state |
| `devices.json` | ESPHome/HomeWizard device list and credentials |
| `_price_history.json` | 32-day rolling price history for pattern detection |
| `_soc_history.json` | 32-day battery SOC profile (cached, refreshed 6-hourly) |
| `_plan_history.json` | Last 3 days of plans (for accuracy comparison) |
| `_plan_accuracy.json` | 30-day rolling plan-vs-actual statistics |
| `claude_usage.json` | Claude API cost tracking and token counters |

## Configuration Files

### Add-on Mode (`options.json`)

Home Assistant add-on configuration accessible via UI:

```json
{
  "ha_url": "http://homeassistant.local:8123",
  "ha_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "entsoe_api_key": "your-api-key",
  "entsoe_country": "BE",
  "timezone": "Europe/Brussels",
  "influx_use_ha_addon": true,
  "influx_url": "",
  "influx_version": "v2",
  "log_level": "info"
}
```

### Docker Mode (`config.yaml` or `.env`)

Standalone configuration via YAML or environment:

```yaml
# config.yaml
standalone_mode: true
flask_port: 5000
ha_url: http://homeassistant.local:8123
ha_token: your_token
entsoe_api_key: your_key
timezone: Europe/Brussels
influx_url: http://influxdb:8086
influx_org: flux
influx_bucket: sensors
claude_api_key: sk-ant-...
log_level: info
```

Or via `.env`:

```
STANDALONE_MODE=true
FLASK_PORT=5000
HA_URL=http://homeassistant.local:8123
HA_TOKEN=...
CLAUDE_API_KEY=sk-ant-...
```

Environment variables override YAML.

## Performance Tuning

### Polling Intervals

Adjust via settings or environment:

| Component | Default | Min | Max | Impact |
|-----------|---------|-----|-----|--------|
| SMA Modbus poll | 10s | 5s | 30s | Faster inverter updates = faster PV limiter response |
| InfluxDB write | 30s | 10s | 60s | More data = more storage, better granularity |
| ESPHome stream | Real-time | — | — | Latency-critical, not configurable |
| Strategy plan | Daily | Per price change | 1/week | More plans = fresher decisions, higher API cost |

### InfluxDB Retention

Limit data storage to manage disk usage:

```yaml
# In docker-compose.yml
environment:
  INFLUXDB_RETENTION: 30d  # Keep 30 days, older data auto-deleted
```

Or via InfluxDB CLI:

```bash
docker exec flux-influxdb influx bucket update \
  --name sensors \
  --retention 30d
```

### Resource Allocation

For Raspberry Pi 4 / limited hardware:

1. Disable prophecy ML forecast (Phase 3) — use rule-based only
2. Reduce InfluxDB retention to 14d
3. Set strategy plan refresh to "daily only" (not per-price-change)
4. Disable anomaly detection if memory-constrained

## Upgrading Features

FLUX uses semantic versioning:

- **Patch (1.27.14):** Bug fixes, no new features
- **Minor (1.28.0):** New features, backward compatible
- **Major (2.0.0):** Breaking changes

Check upgrade path in CHANGELOG.md before updating.

## API Endpoints (Developer Reference)

### Strategy Planning

- `GET /api/strategy/plan` — Retrieve 48-hour plan
- `POST /api/strategy/plan/refresh` — Force recalculation
- `PATCH /api/strategy/settings` — Update thresholds

### Data & History

- `GET /api/forecast/actuals` — Solar production vs forecast
- `GET /api/profit` — Cost analysis (7/30/90 days)
- `GET /api/rte` — Measured round-trip efficiency

### Devices & Automation

- `GET /api/devices` — List ESPHome/HomeWizard devices
- `POST /api/automation/override` — Manual battery command
- `GET /api/automation/status` — Current automation state

See `CLAUDE.md` or backend source for full API documentation.
