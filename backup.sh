#!/usr/bin/env bash
#
# SmartMarstek Backup Script
# Backs up /data/ directory and InfluxDB to a compressed archive
# Usage: ./backup.sh [output_dir]
#

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${1:-.}"
BACKUP_NAME="smartmarstek-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
BACKUP_PATH="$OUTPUT_DIR/$BACKUP_NAME"
TEMP_BACKUP_DIR=$(mktemp -d)

# Colors
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

# Cleanup on exit
cleanup() {
    rm -rf "$TEMP_BACKUP_DIR"
}
trap cleanup EXIT

# ─────────────────────────────────────────────────────────────────────────
# Pre-checks
# ─────────────────────────────────────────────────────────────────────────
log_title "SmartMarstek Backup"

if [[ ! -d "$OUTPUT_DIR" ]]; then
    log_err "Output directory does not exist: $OUTPUT_DIR"
    exit 1
fi

if [[ ! -w "$OUTPUT_DIR" ]]; then
    log_err "Output directory is not writable: $OUTPUT_DIR"
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker &>/dev/null; then
    log_err "Docker not found. Install Docker first."
    exit 1
fi

if ! (docker compose version &>/dev/null || command -v docker-compose &>/dev/null); then
    log_err "docker-compose not found."
    exit 1
fi

# Determine compose command
if docker compose version &>/dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

# ─────────────────────────────────────────────────────────────────────────
# Step 1: Backup /data directory
# ─────────────────────────────────────────────────────────────────────────
log_info "Backing up /data directory..."

if [[ -d "$SCRIPT_DIR/data" ]]; then
    cp -r "$SCRIPT_DIR/data" "$TEMP_BACKUP_DIR/data"
    log_info "/data directory backed up"
else
    log_warn "/data directory not found, skipping"
fi

# ─────────────────────────────────────────────────────────────────────────
# Step 2: Backup InfluxDB
# ─────────────────────────────────────────────────────────────────────────
log_info "Backing up InfluxDB..."

cd "$SCRIPT_DIR"

# Check if InfluxDB container is running
if ! $COMPOSE_CMD ps influxdb | grep -q "Up"; then
    log_warn "InfluxDB container not running. Skipping InfluxDB backup."
    log_warn "Start services with: $COMPOSE_CMD up -d"
else
    # Create InfluxDB backup using influx command in container
    INFLUX_BACKUP_DIR="$TEMP_BACKUP_DIR/influxdb_backup"
    mkdir -p "$INFLUX_BACKUP_DIR"

    # Use influx backup command via docker exec
    if docker exec smartmarstek-influxdb influx backup "$INFLUX_BACKUP_DIR" \
        -t "$(grep '^INFLUX_TOKEN=' "$SCRIPT_DIR/.env" | cut -d= -f2)" 2>/dev/null; then
        log_info "InfluxDB backed up"
    else
        log_warn "InfluxDB backup failed (container may not have influx CLI). Continuing without DB backup."
    fi
fi

# ─────────────────────────────────────────────────────────────────────────
# Step 3: Create metadata
# ─────────────────────────────────────────────────────────────────────────
log_info "Creating backup metadata..."

cat > "$TEMP_BACKUP_DIR/BACKUP_INFO.txt" <<EOF
SmartMarstek Backup
===================
Created: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Hostname: $(hostname)
OS: $(uname -s)

Contents:
  - /data/           JSON configuration and cache files
  - influxdb_backup/ InfluxDB snapshot (if available)
  - BACKUP_INFO.txt  This file

To restore:
  ./restore.sh smartmarstek-backup-*.tar.gz
EOF

log_info "Metadata created"

# ─────────────────────────────────────────────────────────────────────────
# Step 4: Create archive
# ─────────────────────────────────────────────────────────────────────────
log_info "Creating compressed archive..."

if tar czf "$BACKUP_PATH" -C "$TEMP_BACKUP_DIR" . ; then
    log_info "Backup created: $BACKUP_PATH"
    ls -lh "$BACKUP_PATH"
else
    log_err "Failed to create backup archive"
    rm -f "$BACKUP_PATH"
    exit 1
fi

log_title "Backup Complete"
echo ""
echo "Backup file: $BACKUP_PATH"
echo "To restore, use: ./restore.sh $BACKUP_NAME"
echo ""
