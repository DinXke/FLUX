#!/usr/bin/env bash
#
# SmartMarstek Standalone Docker Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/DinXke/FLUX/main/install.sh | bash
#

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────
# Colors & Output
# ─────────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

log_info()  { echo -e "${GREEN}[✓]${RESET} $*"; }
log_warn()  { echo -e "${YELLOW}[!]${RESET} $*"; }
log_err()   { echo -e "${RED}[✗]${RESET} $*" >&2; }
log_title() { echo -e "\n${BOLD}${CYAN}$*${RESET}"; }

# ─────────────────────────────────────────────────────────────────────────
# Detect System
# ─────────────────────────────────────────────────────────────────────────
if [[ ! -f /etc/os-release ]]; then
    log_err "Could not detect OS. Requires Ubuntu/Debian-based system."
    exit 1
fi

OS_ID=$(grep "^ID=" /etc/os-release | cut -d= -f2 | tr -d '"')
if [[ ! "$OS_ID" =~ ^(ubuntu|debian|raspbian)$ ]]; then
    log_warn "This installer is optimized for Ubuntu/Debian. Your OS: $OS_ID"
fi

# ─────────────────────────────────────────────────────────────────────────
# Install Directory
# ─────────────────────────────────────────────────────────────────────────
INSTALL_DIR="${INSTALL_DIR:-$HOME/smartmarstek}"
REPO_URL="https://github.com/DinXke/FLUX.git"
REPO_BRANCH="main"

log_title "SmartMarstek Standalone Docker Installer"
echo "Installing to: $INSTALL_DIR"

# ─────────────────────────────────────────────────────────────────────────
# Step 1: Check/Install Docker
# ─────────────────────────────────────────────────────────────────────────
log_title "Checking Docker..."

if command -v docker &>/dev/null; then
    DOCKER_VER=$(docker --version | awk '{print $3}' | cut -d, -f1)
    log_info "Docker already installed: v$DOCKER_VER"
else
    log_warn "Docker not found. Installing..."

    if [[ "$OS_ID" == "ubuntu" ]] || [[ "$OS_ID" == "debian" ]] || [[ "$OS_ID" == "raspbian" ]]; then
        sudo apt-get update
        sudo apt-get install -y docker.io docker-compose-plugin

        # Add current user to docker group (requires re-login or use `newgrp`)
        if ! id -nG "$USER" | grep -qw docker; then
            log_warn "Adding $USER to docker group (will require re-login)"
            sudo usermod -aG docker "$USER"
            newgrp docker < /dev/null || true
        fi
        log_info "Docker installed successfully"
    else
        log_err "Unsupported OS for automatic Docker install: $OS_ID"
        log_err "Install Docker manually: https://docs.docker.com/engine/install/"
        exit 1
    fi
fi

# Check docker-compose (plugin or standalone)
if docker compose version &>/dev/null; then
    COMPOSE_VER=$(docker compose version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    log_info "docker compose plugin available: v$COMPOSE_VER"
    COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
    COMPOSE_VER=$(docker-compose --version | awk '{print $3}' | cut -d, -f1)
    log_info "docker-compose binary available: v$COMPOSE_VER"
    COMPOSE_CMD="docker-compose"
else
    log_err "docker-compose not found. Install with: sudo apt-get install docker-compose-plugin"
    exit 1
fi

# ─────────────────────────────────────────────────────────────────────────
# Step 2: Clone Repository
# ─────────────────────────────────────────────────────────────────────────
log_title "Cloning repository..."

if [[ -d "$INSTALL_DIR" ]]; then
    log_warn "Directory already exists: $INSTALL_DIR"
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        log_info "Pulling latest changes..."
        cd "$INSTALL_DIR"
        git pull origin "$REPO_BRANCH" || log_warn "Git pull failed, continuing..."
    fi
else
    git clone --branch "$REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR"
    log_info "Repository cloned"
fi

cd "$INSTALL_DIR"

# ─────────────────────────────────────────────────────────────────────────
# Step 3: Create .env file
# ─────────────────────────────────────────────────────────────────────────
log_title "Configuring environment..."

if [[ -f ".env" ]]; then
    log_warn ".env already exists, skipping generation"
else
    if [[ ! -f ".env.example" ]]; then
        log_err ".env.example not found in repository"
        exit 1
    fi

    cp .env.example .env

    # Generate secure passwords
    INFLUX_PASS=$(openssl rand -base64 24)
    GRAFANA_PASS=$(openssl rand -base64 24)
    INFLUX_TOKEN=$(openssl rand -hex 32)

    # Update .env with generated secrets (use 'sed' with different delimiter to avoid / issues)
    sed -i "s|INFLUX_PASSWORD=.*|INFLUX_PASSWORD=$INFLUX_PASS|g" .env
    sed -i "s|GRAFANA_ADMIN_PASSWORD=.*|GRAFANA_ADMIN_PASSWORD=$GRAFANA_PASS|g" .env
    sed -i "s|INFLUX_TOKEN=.*|INFLUX_TOKEN=$INFLUX_TOKEN|g" .env

    log_info ".env generated with secure passwords"
    log_warn "Saved to: $INSTALL_DIR/.env"
fi

# ─────────────────────────────────────────────────────────────────────────
# Step 4: Create data directory
# ─────────────────────────────────────────────────────────────────────────
log_title "Preparing data directories..."

mkdir -p data grafana/provisioning/{dashboards,datasources} nginx/ssl

log_info "Directories created"

# ─────────────────────────────────────────────────────────────────────────
# Step 5: Start Services
# ─────────────────────────────────────────────────────────────────────────
log_title "Starting services..."

$COMPOSE_CMD down 2>/dev/null || true  # Stop any running containers
$COMPOSE_CMD pull                       # Update images
$COMPOSE_CMD up -d                      # Start services

log_info "Services starting (this may take 1-2 minutes)..."

# ─────────────────────────────────────────────────────────────────────────
# Step 6: Wait for Services
# ─────────────────────────────────────────────────────────────────────────
log_title "Waiting for services to be ready..."

WAIT_TIME=0
MAX_WAIT=120

while [[ $WAIT_TIME -lt $MAX_WAIT ]]; do
    if curl -sf http://localhost:5000/api/status >/dev/null 2>&1; then
        log_info "SmartMarstek is ready!"
        break
    fi

    WAIT_TIME=$((WAIT_TIME + 5))
    if [[ $((WAIT_TIME % 15)) -eq 0 ]]; then
        log_warn "Still waiting for services... ($WAIT_TIME/${MAX_WAIT}s)"
    fi
    sleep 5
done

if [[ $WAIT_TIME -ge $MAX_WAIT ]]; then
    log_warn "Services did not become ready in time. Check logs with:"
    echo "  cd $INSTALL_DIR && $COMPOSE_CMD logs -f"
fi

# ─────────────────────────────────────────────────────────────────────────
# Step 7: Show Access URLs
# ─────────────────────────────────────────────────────────────────────────
log_title "Installation Complete!"
echo ""
echo "Access SmartMarstek:"
echo "  ${BOLD}Web Interface:${RESET}  http://localhost:5000"
echo "  ${BOLD}Grafana:${RESET}         http://localhost:3000"
echo "  ${BOLD}InfluxDB:${RESET}        http://localhost:8086"
echo ""
echo "Default credentials (change in .env and restart):"
echo "  ${BOLD}Grafana:${RESET}         admin / (check .env)"
echo "  ${BOLD}InfluxDB:${RESET}        marstek / (check .env)"
echo ""
echo "Useful commands:"
echo "  ${BOLD}View logs:${RESET}       cd $INSTALL_DIR && $COMPOSE_CMD logs -f smartmarstek"
echo "  ${BOLD}Stop services:${RESET}   cd $INSTALL_DIR && $COMPOSE_CMD stop"
echo "  ${BOLD}Restart services:${RESET} cd $INSTALL_DIR && $COMPOSE_CMD restart"
echo "  ${BOLD}Remove all:${RESET}      cd $INSTALL_DIR && $COMPOSE_CMD down -v"
echo ""
echo "Documentation: https://github.com/DinXke/FLUX"
echo ""
