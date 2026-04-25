# FLUX — Flexible Local Utility eXchange

Autonome energiestuurapplicatie voor thuisbatterijen. Fork van SmartMarstek.

**GitHub:** https://github.com/DinXke/FLUX
**Paperclip project:** FLUX (SCH-prefix)

## Architectuur

Dual-mode deployment:
- **Mode A: HA Addon** — via options.json, HA ingress, supervisor
- **Mode B: Standalone Docker** — docker-compose, nginx, config.yaml/.env

## Tech Stack

- Backend: Python 3.11, Flask, asyncio
- Frontend: React 18, Vite, TypeScript
- Data: InfluxDB v1+v2, JSON persistence (/data/)
- Hardware: ESPHome SSE, SMA Modbus TCP, HomeWizard local API
- Cloud: Claude API, OpenAI API, Frank Energie, ENTSO-E, Forecast.Solar, Daikin/Onecta, Bosch Home
- Infra: Docker Compose, Nginx, Grafana

## Kernbestanden

- `app.py` — Flask backend (alle endpoints)
- `strategy.py` — Rule-based strategie engine
- `strategy_claude.py` — AI strategie engine (Claude + OpenAI)
- `influx_writer.py` — InfluxDB writer (30s interval)
- `sma_modbus.py` — SMA Sunny Boy Modbus poller (10s)
- `telegram.py` — Telegram notificaties
- `docker-compose.yml` — Standalone deployment
- `install.sh` — Ubuntu one-liner installer

## Kritische Regels

1. **Geen breaking changes** — SmartMarstek/HA addon compatibiliteit bewaren
2. **Backward compatible** — options.json formaat ongewijzigd
3. **Dual-mode detectie** — `STANDALONE_MODE=true` env var voor standalone
4. **Commit co-auteur** — `Co-Authored-By: Paperclip <noreply@paperclip.ing>`
5. **Release tags** — `git tag vX.Y.Z && git push origin vX.Y.Z` na elke release
6. **Version bump** — `version:` in config.yaml bijwerken bij elke release

## Agent Team

| Agent | Rol | Model | cwd |
|---|---|---|---|
| CTO (a7940bba) | Architect + coördinator | sonnet | /paperclip/projects/FLUX |
| Backend (ffa9a218) | Python/Flask/integraties | haiku | /paperclip/projects/FLUX |
| DevOps (124dd000) | Docker/install/Grafana | haiku | /paperclip/projects/FLUX |

Agent instructies: `agents/cto/AGENTS.md`, `agents/backend/AGENTS.md`, `agents/devops/AGENTS.md`

## Paperclip Issues

Master epic: [SCH-756](/SCH/issues/SCH-756)
- [SCH-750](/SCH/issues/SCH-750) Fase 1: Standalone Docker
- [SCH-751](/SCH/issues/SCH-751) Fase 1: Config-abstractie
- [SCH-752](/SCH/issues/SCH-752) Fase 1: Grafana dashboards
- [SCH-753](/SCH/issues/SCH-753) Fase 2: Daikin + Bosch
- [SCH-754](/SCH/issues/SCH-754) Fase 2: Multi-model AI
- [SCH-755](/SCH/issues/SCH-755) Fase 3: Anomaliedetectie + Prophet
