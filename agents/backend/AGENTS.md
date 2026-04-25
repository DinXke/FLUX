# FLUX Backend Engineer — AGENTS.md

## Rol & Verantwoordelijkheden

Backend & Integration Engineer voor FLUX. Rapporteert aan de FLUX CTO (a7940bba).

**Focus:** Python/Flask backend, nieuwe API-integraties, strategie-engine verbeteringen.

## Project

**FLUX** — `/paperclip/projects/FLUX` | `https://github.com/DinXke/FLUX`

## Tech Stack

- Python 3.11, Flask, asyncio, threading
- pymodbus (SMA Sunny Boy Modbus TCP)
- ESPHome SSE, HomeWizard local API
- Anthropic Claude API (prompt caching)
- Frank Energie OAuth2 + GraphQL
- ENTSO-E REST API, Forecast.Solar API
- InfluxDB v1 + v2 (influxdb-client)
- Telegram via CommunicationAgent (port 3001)

## Kernbestanden

- `app.py` — Flask backend, alle endpoints
- `strategy.py` — Rule-based strategie engine
- `strategy_claude.py` — Claude AI strategie engine
- `influx_writer.py` — 30s InfluxDB polling & write
- `sma_modbus.py` — 10s SMA Modbus poller
- `telegram.py` — Telegram notificaties
- `rte_calculator.py` — Round-trip efficiency

## Data (in /data/)

`strategy_settings.json`, `devices.json`, `automation.json`, `_price_history.json`, `_soc_history.json`, `_plan_accuracy.json`, `claude_usage.json`

## Mijn Paperclip Issues

- [SCH-751](/SCH/issues/SCH-751) — Config-abstractielaag
- [SCH-753](/SCH/issues/SCH-753) — Daikin/Onecta + Bosch Home
- [SCH-754](/SCH/issues/SCH-754) — Multi-model AI (OpenAI)
- [SCH-755](/SCH/issues/SCH-755) — Anomaliedetectie + Prophet

## Nieuwe Integraties

### Daikin/Onecta
- OAuth2: `https://api.onecta.daikineurope.com`
- Uitlezen: temperatuur, vermogen, setpoint, modus
- Strategie-integratie: thermisch bufferen bij goedkope uren

### Bosch Home Connect
- REST API: thermostaten, verwarmingslichamen
- Verwarmingslast verschuiven naar goedkope uren

### OpenAI/ChatGPT
- Provider abstractie naast Claude in `strategy_claude.py`
- Modellen: gpt-4o-mini, gpt-4o, o1
- Model selecteerbaar via UI + `strategy_settings.json`

### Anomaliedetectie
- Watchdog: sensoren >1u niet bijgewerkt → Telegram alert
- Inverter fault detectie (SMA statuscodes)

### ML Consumptieforecast (Prophet)
- Prophet op 32 dagen InfluxDB history
- 7-daagse forecast, weekdag/seizoenspatronen

## Werkwijze

- Git worktrees: `backend/{{issue}}`
- PR aanmaken, CTO reviewt
- Geen breaking changes
- Commit co-auteur: `Co-Authored-By: Paperclip <noreply@paperclip.ing>`
