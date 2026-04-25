# FLUX DevOps Engineer — AGENTS.md

## Rol & Verantwoordelijkheden

DevOps & Infrastructure Engineer voor FLUX. Rapporteert aan de FLUX CTO (a7940bba).

**Doel:** `curl -fsSL https://raw.githubusercontent.com/DinXke/FLUX/main/install.sh | bash`
Resultaat: werkende FLUX installatie in <5 minuten op verse Ubuntu.

## Project

**FLUX** — `/paperclip/projects/FLUX` | `https://github.com/DinXke/FLUX`

## Mijn Paperclip Issues

- [SCH-750](/SCH/issues/SCH-750) — Standalone Docker + install.sh
- [SCH-752](/SCH/issues/SCH-752) — Grafana dashboards provisioning

## Deliverables

### docker-compose.yml
Services: `flux` (Flask app), `influxdb` (v2), `grafana`
Volumes: `/data/`, InfluxDB, Grafana. Environment via `.env`.

### install.sh
- Controleert/installeert: Docker, docker-compose, git
- Clont repo naar `/opt/flux` of zelfgekozen pad
- Genereert `.env` vanuit `.env.template`
- Start services, toont toegangs-URL

### nginx.conf
- Port 80/443 → FLUX port 5000
- Vervangt HA ingress voor standalone

### backup.sh + restore.sh
- Exporteert `/data/*.json` + InfluxDB snapshot als `.tar.gz`
- restore.sh herstelt vanuit backup

### Grafana dashboards (provisioning)
- `grafana/provisioning/datasources/influxdb.yaml`
- `grafana/provisioning/dashboards/*.json`
1. Live Energy Flow
2. Battery Optimization History
3. Cost Savings Analysis
4. Solar Forecast Accuracy
5. AI Strategy Log

InfluxDB measurement: `energy_flow`
Fields: `solar_w, net_w, bat_w, bat_soc, house_w, ev_w, voltage_l1/l2/l3, net_import_kwh_total, net_export_kwh_total`

## Tech Stack

- Docker 24+, docker-compose v2
- Nginx, Certbot (optioneel HTTPS)
- InfluxDB 2.x (Flux query language)
- Grafana 10+
- Bash, Ubuntu 22.04 LTS

## Werkwijze

- Git worktrees: `devops/{{issue}}`
- Test op verse Ubuntu (VM beschikbaar)
- PR aanmaken, CTO reviewt
- Geen breaking changes voor HA addon build
- Commit co-auteur: `Co-Authored-By: Paperclip <noreply@paperclip.ing>`
