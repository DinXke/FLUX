# FLUX Documentation

Comprehensive guides for deploying, configuring, and developing FLUX — the autonomous energy orchestration system for home batteries.

## Quick Links

- **[STANDALONE.md](./STANDALONE.md)** — Complete Docker deployment guide (Ubuntu, Raspberry Pi, NAS)
  - One-liner installation
  - Manual setup steps
  - SSL/TLS, reverse proxy, firewall
  - Backup & restore, monitoring, troubleshooting

- **[FEATURES.md](./FEATURES.md)** — Feature reference and configuration
  - Strategy engines (rule-based, Claude AI, OpenAI)
  - Energy price integrations (Frank Energie, ENTSO-E)
  - Solar forecasting (Forecast.solar)
  - Anomaly detection & ML forecast (Phase 3)
  - Telegram notifications
  - API endpoints reference

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — System design and internals
  - Dual-mode deployment architecture
  - Core Python modules overview
  - Data flow diagrams
  - Frontend component structure
  - Performance optimization (prompt caching, query tuning)
  - Security considerations
  - Extensibility guide for adding new integrations

## Deployment Paths

### For Home Assistant Users
1. Add FLUX repository to HA Add-ons
2. Install via Add-on Store
3. Configure via HA UI (options.json)
4. Access via Ingress sidebar

**Setup time:** ~10 minutes

See: [Home Assistant Installation](../README.md#mode-a-home-assistant-add-on)

### For Linux/Docker Users
1. Run one-liner installer or manual docker-compose setup
2. Configure via config.yaml or .env
3. Access via custom URL or reverse proxy

**Setup time:** ~20 minutes (including Docker installation)

See: [STANDALONE.md](./STANDALONE.md)

## Feature Overview

| Feature | Status | Add-on | Docker | Config |
|---------|--------|--------|--------|--------|
| **Battery Optimization** | ✅ | Yes | Yes | UI + settings |
| **Rule-Based Strategy** | ✅ | Yes | Yes | Thresholds (UI) |
| **Claude AI Strategy** | ✅ | Yes | Yes | API key + model (UI) |
| **OpenAI Strategy** | ✅ | Yes | Yes | API key + model (UI) |
| **Frank Energie Prices** | ✅ | Yes | Yes | OAuth (UI) |
| **ENTSO-E Prices** | ✅ | Yes | Yes | API key (UI) |
| **Solar Forecast** | ✅ | Yes | Yes | Forecast.solar config (UI) |
| **HomeWizard P1/Sockets** | ✅ | Yes | Yes | Auto-discovery (UI) |
| **SMA Modbus Scanner** | ✅ | Yes | Yes | Device IP (UI) |
| **PV Limiter Control** | ✅ | Yes | Yes | Entity + price threshold (UI) |
| **Telegram Notifications** | ✅ | Yes | Yes | Chat ID + URL (UI) |
| **Anomaly Detection** | 🗓 Phase 3 | — | — | — |
| **ML Consumption Forecast** | 🗓 Phase 3 | — | — | — |
| **Daikin/Onecta** | 🗓 Phase 2 | — | — | — |
| **Bosch Home Controls** | 🗓 Phase 2 | — | — | — |
| **MQTT Support** | 🗓 Phase 3 | — | — | — |

## Common Questions

### Can I use both HA Add-on and Standalone?

No, only one instance per Home Assistant. However:
- HA add-on for Home Assistant users (standard setup)
- Standalone Docker for:
  - Systems without Home Assistant
  - Decoupled battery management
  - Custom networking (remote server, multiple locations)
  - Advanced infrastructure (k8s, Nomad, etc.)

### How much does Claude AI cost?

Claude Haiku: €0.002–0.005 per plan (once daily typically).
- 1 plan/day × €0.003 = ~€0.09/month
- Prompt caching reduces 2nd+ runs by 90%

Haiku is recommended. Sonnet 4.6 or GPT-4o-mini available for complex patterns.

### Is my home energy data private?

- **Add-on mode:** Data stays on HA device, no cloud (unless external InfluxDB)
- **Docker mode:** Data stays on your server
- **Claude API calls:** Only price/forecast/consumption *patterns* sent (anonymized, no raw data)
- **HomeWizard:** Uses local API (no cloud required)
- **ESPHome:** Direct communication, no cloud

### How do I update FLUX?

**Add-on:**
- Settings → Add-ons → SmartMarstek → Check for updates → Install

**Docker:**
```bash
cd /opt/flux
git pull origin main
docker-compose pull
docker-compose up -d
```

See [CHANGELOG.md](../CHANGELOG.md) for release notes.

### What if FLUX crashes?

- **Add-on:** HA supervisor auto-restarts
- **Docker:** systemd service or docker-compose restart policy auto-restarts
- **Data:** All configuration and history preserved in volumes
- **Plans:** Last cached plan used until new one calculated

### Can I run FLUX on Raspberry Pi?

Yes. **Raspberry Pi 4 (4GB+) recommended.**

**Limitations:**
- Skip Phase 3 features (anomaly detection, ML forecast) for Pi 3
- Reduce InfluxDB retention to 14 days
- Set strategy refresh to "daily only"

**One-liner setup:** Same `install.sh` works on Raspberry Pi OS.

## Troubleshooting

### FLUX Not Starting

1. Check logs:
   - **Add-on:** HA Settings → Add-ons → SmartMarstek → Logs
   - **Docker:** `docker-compose logs flask`

2. Common causes:
   - Port 5000 already in use (change `FLUX_PORT` in `.env`)
   - InfluxDB not ready (wait 30s, restart)
   - API key invalid (verify in Settings)

3. Still stuck? File issue on [GitHub](https://github.com/DinXke/FLUX/issues)

### Battery Not Responding

1. Verify ESPHome device:
   - Ping: `ping <device-ip>`
   - Check HA for entity `sensor.<device>_soc`

2. Check FLUX logs for connection errors

3. Restart ESPHome device

See [FEATURES.md#anomaly-detection](./FEATURES.md#anomaly-detection) for monitoring battery health.

### Prices Not Updating

1. Verify API key valid:
   - Frank Energie: Check OAuth token in Settings
   - ENTSO-E: Test API key at https://transparency.entsoe.eu

2. Check internet connectivity: `curl https://api.forecast.solar`

3. Review logs for rate-limit errors

### High Disk Usage (Docker)

InfluxDB retention is set to 30 days by default. To reduce:

```bash
docker exec flux-influxdb influx bucket update \
  --name sensors \
  --retention 14d
```

## Developer Resources

### Source Code

- **Backend:** `/backend/` (Python Flask)
  - `app.py` — Main Flask app (routes, pollers, automation)
  - `strategy.py` — Rule-based planning
  - `strategy_claude.py` — AI planning
  - `llm_provider.py` — LLM abstraction layer
  - `influx_writer.py` — InfluxDB time-series writer
  - `sma_modbus.py` — SMA Sunny Boy Modbus reader
  - `telegram.py` — Telegram notifications

- **Frontend:** `/frontend/` (React + Vite)
  - `src/pages/` — Main UI pages
  - `src/components/` — Reusable React components
  - `src/context/` — State management
  - `src/styles/` — CSS + theme variables

### Running Locally

**Backend:**
```bash
cd backend
pip install -r requirements.txt
python app.py  # Runs on http://localhost:5000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev  # Runs on http://localhost:5173
```

### API Documentation

Full endpoint reference in [FEATURES.md#api-endpoints-developer-reference](./FEATURES.md#api-endpoints-developer-reference)

Example:
```bash
# Get current strategy plan
curl http://localhost:5000/api/strategy/plan | jq

# Update settings
curl -X PATCH http://localhost:5000/api/strategy/settings \
  -H "Content-Type: application/json" \
  -d '{"max_charge_power_kw": 3.5}'
```

## Community & Support

- **GitHub Issues:** [Report bugs & feature requests](https://github.com/DinXke/FLUX/issues)
- **GitHub Discussions:** [Share ideas & ask questions](https://github.com/DinXke/FLUX/discussions)
- **SmartMarstek (Original):** [Background & history](https://github.com/DinXke/SmartMarstek)

## License

MIT © [DinXke](https://github.com/DinXke)

FLUX is a fork of SmartMarstek with additions. Both projects use the MIT license.

---

**Latest Docs Updated:** 2026-04-26  
**FLUX Version:** 1.27.14+
