# FLUX Standalone Docker Deployment Guide

This guide covers deploying FLUX as a standalone Docker application on Linux/Raspberry Pi/NAS without Home Assistant dependency.

## Quick Start

### One-liner Installation (Ubuntu 20.04+)

```bash
curl -fsSL https://raw.githubusercontent.com/DinXke/FLUX/main/install.sh | bash
```

This script:
1. Installs Docker & Docker Compose (if not already present)
2. Clones FLUX repository to `/opt/flux`
3. Generates `.env` configuration with sensible defaults
4. Creates systemd service for automatic startup
5. Initializes InfluxDB container and volumes
6. Configures Nginx reverse proxy (optional)
7. Starts all containers and runs health checks

After installation, FLUX is accessible at `http://localhost:5000` (or your custom domain via Nginx).

## Manual Installation

### Prerequisites

- **Linux host:** Ubuntu 20.04+, Raspberry Pi OS, or other distributions with Docker support
- **Docker:** Version 20.10+ (install via `curl -fsSL https://get.docker.com | sh`)
- **Docker Compose:** Version 2.0+ (included with Docker Desktop)
- **Memory:** 2GB RAM minimum (4GB+ recommended for ML forecast models)
- **Disk:** 5GB for containers + logs, 10-50GB for InfluxDB (depending on retention)

### Step 1: Clone Repository

```bash
git clone https://github.com/DinXke/FLUX.git
cd FLUX
```

### Step 2: Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```bash
# Core
STANDALONE_MODE=true
FLUX_PORT=5000
FLUX_HOST=0.0.0.0

# Home Assistant (if integrated)
HA_URL=http://homeassistant.local:8123
HA_TOKEN=your_long_lived_access_token

# Pricing API Keys
ENTSO_E_API_KEY=your_entso_e_key
FRANK_ENERGIE_CLIENT_ID=your_frank_id
FRANK_ENERGIE_CLIENT_SECRET=your_frank_secret

# Time Zone
TZ=Europe/Brussels

# InfluxDB
INFLUX_ORG=flux
INFLUX_BUCKET=sensors
INFLUX_TOKEN=your_influx_token

# Claude API (if using AI strategy)
CLAUDE_API_KEY=your_claude_key
CLAUDE_MODEL=claude-haiku-4-5-20251001

# OpenAI API (alternative to Claude)
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-4o-mini

# Logging
LOG_LEVEL=info
```

### Step 3: Start Containers

```bash
docker-compose up -d
```

Verify containers are running:

```bash
docker-compose ps
```

Expected output:
```
NAME                COMMAND                  STATUS
flux-flask          python app.py            Up (healthy)
flux-influxdb       /entrypoint.sh           Up
flux-nginx          nginx -g daemon off...   Up (healthy)
```

### Step 4: Initialize InfluxDB

On first run, InfluxDB creates the database and token. Access the InfluxDB UI:

- **URL:** `http://localhost:8086`
- **Initial setup:** Create organization, bucket, API token

Or initialize via CLI:

```bash
docker exec flux-influxdb influx setup \
  --username admin \
  --password your_password \
  --org flux \
  --bucket sensors \
  --retention 30d \
  --force
```

### Step 5: Configure FLUX UI

Navigate to `http://localhost:5000`:

1. **Devices** → Add ESPHome battery (IP/hostname)
2. **Settings → Strategy** → Battery capacity, RTE, SOC limits
3. **Settings → Tariffs** → Frank Energie or ENTSO-E API keys
4. **Settings → Solar** → Forecast.solar configuration (lat/lon, kW-peak)
5. **Settings → InfluxDB** → InfluxDB connection (should auto-detect)
6. **Automation** → Enable battery orchestration

## Advanced Configuration

### Reverse Proxy (Nginx)

FLUX includes a preconfigured Nginx reverse proxy in `docker-compose.yml`. To use a custom domain:

Edit `nginx/flux.conf`:

```nginx
server {
    listen 80;
    server_name flux.example.com;

    location / {
        proxy_pass http://flask:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Restart Nginx:

```bash
docker-compose restart nginx
```

### SSL/TLS with Let's Encrypt

Use Certbot to obtain a free certificate:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot certonly --standalone -d flux.example.com
```

Update `nginx/flux.conf`:

```nginx
server {
    listen 443 ssl http2;
    server_name flux.example.com;

    ssl_certificate /etc/letsencrypt/live/flux.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/flux.example.com/privkey.pem;

    location / {
        proxy_pass http://flask:5000;
        # ... other headers
    }
}

server {
    listen 80;
    server_name flux.example.com;
    return 301 https://$server_name$request_uri;
}
```

Mount certificates in `docker-compose.yml`:

```yaml
services:
  nginx:
    volumes:
      - /etc/letsencrypt:/etc/letsencrypt:ro
```

### Firewall Rules (UFW)

Allow inbound traffic:

```bash
sudo ufw allow 5000/tcp     # FLUX HTTP
sudo ufw allow 80/tcp       # HTTP (for Let's Encrypt renewal)
sudo ufw allow 443/tcp      # HTTPS
sudo ufw allow 8086/tcp     # InfluxDB (local only: restrict to 127.0.0.1)
sudo ufw enable
```

For InfluxDB, restrict to localhost:

In `.env`, set:

```
INFLUX_LISTEN=127.0.0.1
```

### Data Persistence

FLUX uses Docker volumes for data persistence:

- **`flux_influxdb_data`** — Time-series data, persists across restarts
- **`flux_flux_data`** — Configuration JSON files, strategy plans, history

Backup volumes:

```bash
# Backup InfluxDB
docker run --rm \
  -v flux_influxdb_data:/data \
  -v $(pwd)/backups:/backup \
  busybox tar czf /backup/influxdb_$(date +%Y%m%d).tar.gz -C /data .

# Backup FLUX config
docker run --rm \
  -v flux_flux_data:/data \
  -v $(pwd)/backups:/backup \
  busybox tar czf /backup/flux_config_$(date +%Y%m%d).tar.gz -C /data .
```

Restore:

```bash
# Stop containers
docker-compose stop

# Restore data
docker run --rm \
  -v flux_influxdb_data:/data \
  -v $(pwd)/backups:/backup \
  busybox tar xzf /backup/influxdb_YYYYMMDD.tar.gz -C /data

# Restart
docker-compose up -d
```

### Log Management

View logs:

```bash
# All containers
docker-compose logs -f

# Specific service
docker-compose logs -f flask
docker-compose logs -f influxdb

# Last 100 lines with timestamps
docker-compose logs --timestamps --tail=100 flask
```

Rotate logs to prevent disk filling:

In `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "10"
  }
}
```

Restart Docker:

```bash
sudo systemctl restart docker
```

## Troubleshooting

### FLUX Container Not Starting

Check logs:

```bash
docker-compose logs flask
```

Common issues:
- **Port 5000 already in use:** Change `FLUX_PORT` in `.env`
- **Memory limit exceeded:** Increase Docker memory allocation
- **Permission denied on volumes:** Run `docker-compose` with elevated privileges

### InfluxDB Connection Failed

Verify InfluxDB is running:

```bash
docker-compose ps influxdb
docker exec flux-influxdb influx ping
```

Check credentials in `.env` match InfluxDB setup.

### Battery Not Responding

1. Verify ESPHome device is reachable: `ping <battery-ip>`
2. Check firewall allows TCP port 6053 (ESPHome API)
3. Verify device IP in FLUX settings matches actual device

### Forecast/Prices Not Updating

1. Verify API keys in Settings (ENTSO-E, Frank Energie, Forecast.solar)
2. Check internet connectivity: `curl https://api.forecast.solar`
3. Review logs for API errors: `docker-compose logs flask | grep -i api`

### High Disk Usage

InfluxDB retention can grow large. Adjust in `docker-compose.yml`:

```yaml
environment:
  INFLUXDB_RETENTION: "30d"  # Reduce from default 7+ days
```

Cleanup old data:

```bash
docker exec flux-influxdb influx bucket delete --name sensors
docker exec flux-influxdb influx bucket create --name sensors --retention 30d
```

## Systemd Service (Auto-startup)

Create `/etc/systemd/system/flux.service`:

```ini
[Unit]
Description=FLUX Energy Orchestration
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/docker-compose -f /opt/flux/docker-compose.yml up -d
ExecStop=/usr/bin/docker-compose -f /opt/flux/docker-compose.yml down
RemainAfterExit=yes
WorkingDirectory=/opt/flux

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable flux
sudo systemctl start flux
```

Check status:

```bash
sudo systemctl status flux
docker-compose ps
```

## Monitoring & Health Checks

FLUX includes health check endpoints:

- **`/health`** — Flask status (ready, down)
- **`/health/influx`** — InfluxDB connectivity
- **`/health/ha`** — Home Assistant connectivity (if configured)

Monitor health:

```bash
# Flask
curl http://localhost:5000/health

# Via Docker
docker inspect --format='{{.State.Health.Status}}' flux-flask
```

Set up Prometheus monitoring (optional):

Create `prometheus.yml`:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'flux'
    static_configs:
      - targets: ['localhost:5000']
```

## Updating FLUX

Pull latest changes:

```bash
cd /opt/flux
git pull origin main
docker-compose pull
docker-compose up -d
```

Monitor migration:

```bash
docker-compose logs -f flask
```

## Support & Documentation

- **GitHub Issues:** https://github.com/DinXke/FLUX/issues
- **Project Docs:** `docs/` directory in repository
- **SmartMarstek (Original):** https://github.com/DinXke/SmartMarstek

## Uninstall

Remove containers and volumes:

```bash
cd /opt/flux
docker-compose down -v  # -v removes volumes (data loss)
rm -rf /opt/flux
```

Keep data but remove containers:

```bash
docker-compose down  # Preserves volumes
# Later: docker-compose up -d  to restart
```
