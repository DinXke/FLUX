# FLUX Architecture & Design

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend Layer                          │
│  React 18 + Vite (TypeScript) • Live energy map • Dashboards   │
│  Strategy timeline • Settings UI • Profit analysis             │
└─────────────────────┬───────────────────────────────────────────┘
                      │ REST API (relative URLs for HA Ingress)
┌─────────────────────▼───────────────────────────────────────────┐
│                    Flask Backend (Python 3.13)                  │
│  ┌──────────────────────┐        ┌─────────────────────────┐   │
│  │  HTTP & WebSocket    │        │   Strategy Engine       │   │
│  │  (Routes & REST API) │        │  • Rule-based logic     │   │
│  └──────────────────────┘        │  • Claude AI planning   │   │
│                                  │  • OpenAI alternatives  │   │
│  ┌──────────────────────┐        └─────────────────────────┘   │
│  │  Data Collection     │        ┌─────────────────────────┐   │
│  │  (Pollers)           │        │   Monitoring            │   │
│  │  • ESPHome (10s)     │        │  • Anomaly detection    │   │
│  │  • SMA Modbus (10s)  │        │  • Prophet ML forecast  │   │
│  │  • HomeWizard (30s)  │        │  • Telegram alerts      │   │
│  │  • HA API            │        │  • Health checks        │   │
│  └──────────────────────┘        └─────────────────────────┘   │
│  ┌──────────────────────┐        ┌─────────────────────────┐   │
│  │  Actuators           │        │   Configuration         │   │
│  │  • Battery commands  │        │  • options.json (HA)    │   │
│  │  • PV limiter control│        │  • config.yaml (Docker) │   │
│  │  • 1-min automation  │        │  • .env secrets         │   │
│  └──────────────────────┘        └─────────────────────────┘   │
└──────────┬──────────┬──────────┬──────────┬────────────────────┘
           │          │          │          │
      InfluxDB   ESPHome    HomeWizard   Home Assistant
    (TimeSeries) (Battery) (P1/Sockets) (Entities)
           │          │          │          │
     Frank Energie / ENTSO-E / Forecast.solar / Claude API
```

## Dual-Mode Deployment

### Architecture Differences

| Aspect | HA Add-on | Standalone Docker |
|--------|-----------|-------------------|
| **Config Source** | `/data/options.json` | `config.yaml` or `.env` |
| **Home Assistant** | Integrated, Ingress | Optional, HTTP/REST only |
| **Database** | External (IP configured) | Local InfluxDB container |
| **Networking** | Via `supervisor/core` | Direct Docker network |
| **Reverse Proxy** | HA handles it | Nginx in compose |
| **Systemd** | HA add-on supervisor | Docker daemon |
| **Data Persistence** | HA `/data` partition | Docker volumes |
| **Env Detection** | Checks `SUPERVISOR_TOKEN` | `STANDALONE_MODE=true` |

### Config Abstraction Layer

Both modes use identical backend logic:

1. **Startup:**
   - `setup_config.py` reads source (`options.json` or `config.yaml`)
   - Normalizes to internal `settings` dict
   - Writes individual JSON files to `/data/`

2. **Runtime:**
   - All code references normalized settings
   - No mode-specific branches
   - Single code path for both modes

3. **API:**
   - GET `/api/strategy/settings` returns current state
   - PATCH `/api/strategy/settings` updates (auto-saves to source)
   - Relative URLs work behind HA Ingress proxy

## Core Modules

### `app.py` (~12,000 lines)

Main Flask application. Key components:

```python
# Initialization
@app.before_request
  → Config loading
  → HA Ingress base path setup
  → CORS/security headers

# Data Collection Threads
  → poll_esphome_loop() — 10s poll
  → poll_sma_modbus_loop() — 10s poll
  → poll_homewizard_loop() — 30s poll
  → poll_influx_writer() — 30s batch writes

# Automation Loop
  → automation_loop() — 1-minute battery commands
  → Check strategy plan
  → Apply actions to ESPHome devices
  → Track execution status

# Strategy Planning
  → GET /api/strategy/plan
    ├── Fetch live data (SOC, prices, forecast)
    ├── Call strategy engine (rule-based or Claude)
    └── Cache result + timestamps

# Settings API
  → GET /api/strategy/settings
  → PATCH /api/strategy/settings
  → Validates & persists to /data/
```

### `strategy.py`

Rule-based deterministic battery planning:

```python
def compute_strategy_plan(
    prices_48h: List[float],         # €/kWh
    solar_forecast_48h: List[float], # kW
    consumption_history: Dict,       # Weekday/hour patterns
    current_soc_pct: float,         # 0-100%
    settings: Dict                   # RTE, capacities, thresholds
) -> List[Action]:
    """
    Returns 48 actions: ['solar_charge', 'grid_charge', 'discharge', 'save', 'neutral']
    """
```

Algorithm:
1. Normalize prices to break-even basis
2. Find lookahead windows (8h charging, 16h discharging)
3. Apply greedy best-first selection with SOC constraints
4. Post-process: prevent infeasible (discharge when low) actions

**Cost:** O(1) — no ML inference, pure arithmetic

### `strategy_claude.py`

AI-powered adaptive planning:

```python
def compute_strategy_plan_claude(
    prices_48h, solar, consumption, soc_pct, settings, llm_provider
) -> List[Action]:
    """Uses Claude or OpenAI to optimize battery actions"""
```

Flow:
1. **Prep:** Normalize all inputs, calculate break-even per slot
2. **LLM Call:** Send structured JSON to Claude/OpenAI with system prompt
3. **Parse:** Extract tool call `submit_battery_plan(slots=[...])`
4. **Validate:** Feasibility check (SOC ≥ reserve when discharging, etc.)
5. **Enhance:** Add post-processing rules (save → solar_charge on overage)
6. **Log:** Track token usage to `claude_usage.json`

**Cost:** €0.002–0.010 per plan (depends on model, caching)

### `llm_provider.py` (Phase 2)

Abstract LLM interface supporting Claude + OpenAI:

```python
class LLMProvider(ABC):
    @abstractmethod
    def call_planning_api(self, context: Dict) -> str:
        """Returns plan JSON"""

class ClaudeProvider(LLMProvider):
    # Uses Anthropic SDK with prompt caching

class OpenAIProvider(LLMProvider):
    # Uses OpenAI SDK

class AutoProvider(LLMProvider):
    # Selects Claude or OpenAI based on complexity
```

### `influx_writer.py`

InfluxDB time-series writer:

```python
def write_measurements(
    tags: Dict,      # device_id, source, etc.
    fields: Dict,    # Values to write (bat_w, bat_soc, etc.)
    timestamp: int   # Unix nanoseconds
):
    """Batch-writes 30s of accumulated data"""
```

**Data Model:**
- Measurement: `energy`
- Tags: `device_id`, `source` (esphome, sma, ha, hw)
- Fields: `bat_w`, `bat_soc`, `solar_w`, `house_w`, `net_w`, etc.
- Retention: 30 days (configurable)

**Sampling:** Polls every 10–30s, writes in 30s batches to reduce network load

### `sma_modbus.py`

SMA Sunny Boy Modbus TCP reader:

```python
def poll_sma_modbus(
    host: str,
    device_id: int = 3,
    registers: List[int] = REGISTERS_SMA_SUNNY_BOY
) -> Dict:
    """Returns {ac_w: 1234, dc_w: 1200, daily_kwh: 45.2, error_code: 0}"""
```

**Registers:**
- 30059: AC Output Power
- 30867–30868: Daily energy (dword)
- 43009: Error code (0 = OK)

**Modbus Function:** FC3 Read Holding Registers

### `anomaly_detection.py` (Phase 3)

Monitors sensor health and inverter state:

```python
class AnomalyDetector:
    def check_sensor_staleness(
        self, device_id: str, last_update_ts: int, now_ts: int
    ) -> Optional[Alert]:
        """Alert if > 1 hour since last data"""

    def check_inverter_faults(
        self, modbus_error_code: int, sma_status: str
    ) -> Optional[Alert]:
        """Fault if error_code != 0"""

    def check_power_spikes(
        self, current_w: float, history_1h_avg: float
    ) -> Optional[Alert]:
        """Alert if > 2x moving average"""
```

### `prophet_forecast.py` (Phase 3)

ML consumption prediction:

```python
def forecast_consumption(
    influx_client, days_back: int = 32, horizon_days: int = 7
) -> Dict:
    """
    Returns {
        forecast: [kW per hour for next 7 days],
        confidence_80: [...],
        confidence_95: [...]
    }
    """
```

Uses Facebook Prophet library with auto-detected seasonality.

### `telegram.py`

Telegram notification sender:

```python
def notify_event(
    event: str,  # "plan_ready", "grid_charge_opportunity", etc.
    payload: Dict,
    raise_on_error: bool = False
):
    """POST to CommunicationAgent at telegram_comm_url"""
```

## Data Flow

### Battery Polling Cycle

Every 10 seconds:

```
ESPHome SSE Stream
    ↓
_poll_esphome() — Parse SSE, extract SOC/power/voltage
    ↓
batch_queue (accumulated 10s–30s)
    ↓
_send_to_influxdb() — Batch write via InfluxDB client
    ↓
InfluxDB Timeseries DB
    ↓
GET /api/live-sensors (WebSocket for UI)
```

### Strategy Planning Cycle

When price updates OR daily refresh:

```
1. Check if plan needs refresh
   ├─ Price changed? (Frank Energie or ENTSO-E)
   ├─ New day started?
   └─ User requested refresh?

2. Gather context
   ├─ _do_live_soc() — Get current battery SOC
   ├─ _do_prices() — Fetch 48h all-in prices
   ├─ _do_forecast_solar() — Fetch 48h solar forecast
   ├─ _do_consumption_profile() — Query 32d InfluxDB history
   └─ _get_accuracy_summary() — Compare past plans to actuals

3. Call strategy engine
   ├─ Rule-based → compute_strategy_plan(...)
   └─ Claude → compute_strategy_plan_claude(...) → LLM call

4. Validate & post-process
   ├─ Feasibility check (SOC constraints)
   ├─ Save → solar_charge on overage
   └─ Add explanations per slot

5. Cache & respond
   ├─ Save to _plan_cache JSON
   ├─ Write to InfluxDB (plan metadata)
   └─ Return to API caller (frontend)
```

### Automation Execution Loop

Every 60 seconds:

```
1. Load current strategy plan (cached)

2. Determine current hour slot
   └─ Match plan[hour].action

3. Get live sensor data
   ├─ Current SOC
   ├─ Current power flows
   └─ Inverter state (SMA modbus)

4. Determine battery command
   ├─ solar_charge → Set mode to "Neutral" (anti-export, no grid charge)
   ├─ grid_charge → Set mode + force charge power + target SOC
   ├─ discharge → Allow discharge at max power
   ├─ save → Anti-feed (prevent feed to grid)
   └─ neutral → Transparent battery (follow load)

5. Check automation guards
   ├─ Is automation enabled?
   ├─ Battery online?
   ├─ Inverter not in AC Bypass or Fault?
   └─ Not in manual override?

6. Send command to ESPHome
   └─ PUT /api/esphome/{device_id}/command

7. Log execution
   ├─ Save to automation.json
   ├─ Write execution event to InfluxDB
   └─ Update UI status
```

## Frontend Architecture

### React Component Tree

```
<App>
  ├─ <Header> (navigation, theme toggle)
  ├─ <Sidebar> (nav links, device status)
  └─ <Router>
      ├─ <EnergyPage>
      │   ├─ <EnergyMap> (live power flows)
      │   └─ <DeviceStatus> (battery, inverter, sensors)
      ├─ <StrategyPage>
      │   ├─ <StrategyTimeline> (48h bars, actions)
      │   └─ <HourlyDetails> (expandable)
      ├─ <ProfitPage>
      │   ├─ <PeriodSelector> (7/30/90 days)
      │   └─ <ProfitChart> (savings analysis)
      ├─ <SettingsPage>
      │   ├─ <SystemSettings> (HA/InfluxDB/etc)
      │   ├─ <StrategySettings> (battery specs, RTE)
      │   ├─ <TariffsSettings> (Frank/ENTSO-E)
      │   ├─ <SolarSettings> (Forecast.solar)
      │   └─ <TelegramSettings>
      ├─ <ForecastPage> (solar + actual vs forecast)
      ├─ <PriceHistoryPage> (Frank consumption)
      └─ <SMAPanel> (Modbus scanner, registers)
```

### State Management

Uses React hooks + Context API (no Redux):

```typescript
// /src/context/SettingsContext.tsx
export const SettingsContext = createContext<{
  settings: StrategySettings | null;
  loading: boolean;
  saveSettings: (updates: Partial<StrategySettings>) => Promise<void>;
}>(null);

// Usage in component:
const { settings, saveSettings } = useContext(SettingsContext);
```

### API Integration

Relative URLs for HA Ingress compatibility:

```typescript
// Automatically becomes /api/ingress_prefix/api/...
const response = await fetch('api/strategy/plan');
const data = await response.json();
```

### Styling

CSS variables for theme support (dark/light/matrix):

```css
/* /src/styles/App.css */
:root {
  --bg-primary: #0f172a;
  --bg-card: #1e293b;
  --accent: #C17A3A;  /* Scheepers Amber */
  --text-primary: #f1f5f9;
  --border: #334155;
}

[data-theme="light"] {
  --bg-primary: #f8fafc;
  --bg-card: #ffffff;
  --accent: #C17A3A;
  --text-primary: #0f172a;
  --border: #e2e8f0;
}
```

## Security Considerations

### API Key Storage

- **Sensitive fields:** HA token, API keys, InfluxDB password
- **Storage:** JSON files in `/data/` with file permission `0600` (read-only to process)
- **UI masking:** Settings page shows `••••••••` for stored values
- **Fallback:** If UI sends masked value during update, uses stored value

### Authentication

- **HA mode:** Relies on HA Supervisor token for API calls (`SUPERVISOR_TOKEN`)
- **Docker mode:** No built-in auth (assume network-isolated or behind reverse proxy)
- **Future:** Consider JWT token support for Docker mode

### CORS & Headers

```python
# app.py
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    if os.getenv('STANDALONE_MODE'):
        response.headers['Access-Control-Allow-Origin'] = '*'
    return response
```

### WebSocket (SSE for Live Data)

Uses Server-Sent Events (not WebSocket) for:
- Live power flows
- Sensor updates
- Plan status changes

No authentication needed (reads only, no control commands).

## Performance Optimization

### Prompt Caching (Claude API)

System prompt (~2,000 tokens) cached with `cache_control: ephemeral`:

**First call:** Read new tokens at $3.00/MTok
**Subsequent calls:** Read cached tokens at $0.30/MTok (90% savings)

Relevant for daily planning runs (cache expires ~5 min).

### Query Optimization

**InfluxDB:**
- Use bulk query for SOC history (1 query vs 32 individual queries)
- 6-hour cache on soc_history.json
- Aggregate to hourly before sending to Claude

**HA API:**
- Cache entity state in memory
- Poll every 30s, don't hammer with per-second requests
- Use compressed history queries

### Data Aggregation

**Consumption profile:** Pre-aggregate 32d history into (weekday, hour) bins before sending to Claude
**Price patterns:** Store P25/P75/avg, not individual slot prices

## Extensibility

### Adding a New Price Source

1. Create `fetch_new_provider.py`:
   ```python
   def fetch_prices_new_provider(api_key: str, country: str) -> Dict[str, float]:
       # Return {timestamp: price_eur_kwh}
   ```

2. Update `_do_prices()` in `app.py`:
   ```python
   if settings['price_source'] == 'new_provider':
       prices = fetch_prices_new_provider(...)
   ```

3. Add UI settings in Settings → Tariffs

### Adding a New Battery Type

1. Create `battery_new_vendor.py`:
   ```python
   def poll_new_vendor_api(host: str) -> Dict:
       # Return {soc_pct, power_w, voltage_v, ...}
   ```

2. Update `_poll_esphome()` detection logic

3. Add device type to Settings → Devices dropdown

## Testing & Monitoring

### Unit Tests

```bash
pytest backend/tests/
pytest backend/tests/test_strategy.py -v
```

Coverage targets:
- Strategy algorithm: 95%+
- Data parsing: 100%
- API routes: 85%+

### Health Checks

- **`GET /health`** → Flask up?
- **`GET /health/influx`** → InfluxDB reachable?
- **`GET /health/ha`** → Home Assistant reachable?

Used by Docker health check and monitoring systems.

### Logging Levels

- **DEBUG:** Sensor values, API calls, strategy internals
- **INFO:** Plan calculation, automation actions, daily summaries
- **WARNING:** Failed API calls, missing config, sensor staleness
- **ERROR:** Crashes, unrecoverable errors

View logs:
- **HA Add-on:** Settings → Add-ons → SmartMarstek → Logs
- **Docker:** `docker-compose logs -f flask`

## Future Roadmap

### Phase 2 (In Progress)
- ✅ Multi-model AI (Claude + OpenAI)
- ⏳ Daikin/Onecta integration (heat pump coordination)
- ⏳ Bosch Home integration (heating controls)

### Phase 3 (Planned)
- 🗓 Anomaly detection (sensor health, fault detection)
- 🗓 Prophet ML forecast (consumption prediction)
- 🗓 MQTT abstraction layer (generic device control)

### Phase 4 (Ideas)
- 📋 Mobile app (React Native)
- 📋 Grafana dashboard templates
- 📋 Historical plan comparison (why did plan differ from actual?)
