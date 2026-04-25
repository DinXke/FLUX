#!/usr/bin/env bash
#
# SmartMarstek Restore Script
# Restores a backup created by backup.sh
# Usage: ./restore.sh backup_file.tar.gz
#

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_FILE="${1:-.}"
TEMP_RESTORE_DIR=$(mktemp -d)

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
    rm -rf "$TEMP_RESTORE_DIR"
}
trap cleanup EXIT

# ─────────────────────────────────────────────────────────────────────────
# Pre-checks
# ─────────────────────────────────────────────────────────────────────────
log_title "SmartMarstek Restore"

if [[ -z "$BACKUP_FILE" ]] || [[ "$BACKUP_FILE" == "." ]]; then
    log_err "Usage: $0 backup_file.tar.gz"
    exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
    log_err "Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Make absolute path
if [[ ! "$BACKUP_FILE" = /* ]]; then
    BACKUP_FILE="$(cd "$(dirname "$BACKUP_FILE")" && pwd)/$(basename "$BACKUP_FILE")"
fi

log_info "Backup file: $BACKUP_FILE"
log_info "Size: $(du -h "$BACKUP_FILE" | cut -f1)"

# ─────────────────────────────────────────────────────────────────────────
# Step 1: Extract backup
# ─────────────────────────────────────────────────────────────────────────
log_title "Extracting backup..."

if tar xzf "$BACKUP_FILE" -C "$TEMP_RESTORE_DIR"; then
    log_info "Backup extracted"
else
    log_err "Failed to extract backup"
    exit 1
fi

# ─────────────────────────────────────────────────────────────────────────
# Step 2: Restore /data directory
# ─────────────────────────────────────────────────────────────────────────
log_info "Restoring /data directory..."

if [[ -d "$TEMP_RESTORE_DIR/data" ]]; then
    # Backup current data before overwriting
    if [[ -d "$SCRIPT_DIR/data" ]]; then
        CURRENT_BACKUP="$SCRIPT_DIR/data.backup.$(date +%s)"
        log_warn "Current /data exists. Saving to: $CURRENT_BACKUP"
        mv "$SCRIPT_DIR/data" "$CURRENT_BACKUP"
    fi

    # Restore from backup
    mv "$TEMP_RESTORE_DIR/data" "$SCRIPT_DIR/data"
    log_info "/data directory restored"
else
    log_warn "No /data directory in backup"
fi

# ─────────────────────────────────────────────────────────────────────────
# Step 3: Restore InfluxDB
# ─────────────────────────────────────────────────────────────────────────
if [[ -d "$TEMP_RESTORE_DIR/influxdb_backup" ]]; then
    log_title "Restoring InfluxDB..."

    # Check if docker-compose is available
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

    cd "$SCRIPT_DIR"

    # Check if InfluxDB is running
    if ! $COMPOSE_CMD ps influxdb | grep -q "Up"; then
        log_warn "InfluxDB container not running. Starting services first..."
        $COMPOSE_CMD up -d influxdb
        sleep 10
    fi

    # Restore InfluxDB backup
    INFLUX_TOKEN=$(grep '^INFLUX_TOKEN=' .env | cut -d= -f2)

    if docker exec smartmarstek-influxdb influx restore "$TEMP_RESTORE_DIR/influxdb_backup" \
        -t "$INFLUX_TOKEN" 2>/dev/null; then
        log_info "InfluxDB restored"
    else
        log_warn "InfluxDB restore failed. Ensure InfluxDB is running and database is empty."
        log_warn "To manually restore, run:"
        log_warn "  docker exec smartmarstek-influxdb influx restore /tmp/backup_dir -t \$TOKEN"
    fi
else
    log_warn "No InfluxDB backup in archive"
fi

# ─────────────────────────────────────────────────────────────────────────
# Step 4: Restart services
# ─────────────────────────────────────────────────────────────────────────
log_title "Restarting services..."

cd "$SCRIPT_DIR"

if (docker compose version &>/dev/null || command -v docker-compose &>/dev/null); then
    if docker compose version &>/dev/null; then
        COMPOSE_CMD="docker compose"
    else
        COMPOSE_CMD="docker-compose"
    fi

    if $COMPOSE_CMD ps | grep -q "smartmarstek"; then
        log_info "Restarting SmartMarstek..."
        $COMPOSE_CMD restart smartmarstek
        log_info "Services restarted"
    fi
fi

log_title "Restore Complete"
echo ""
echo "Backup file: $BACKUP_FILE"
echo ""
echo "Your data has been restored. If you see any issues:"
echo "  - Check logs: $COMPOSE_CMD logs -f smartmarstek"
echo "  - Verify data: ls -la $SCRIPT_DIR/data/"
echo ""
