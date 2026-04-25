#!/bin/bash
set -e

# SmartMarstek Standalone Docker Entrypoint
# Runs before Flask starts, configures environment

DATA_DIR="${MARSTEK_DATA_DIR:-/data}"
FRONTEND_DIST="${MARSTEK_FRONTEND_DIST:-/app/frontend/dist}"

mkdir -p "$DATA_DIR"

echo "[smartmarstek] Data directory: $DATA_DIR"
echo "[smartmarstek] Frontend dist: $FRONTEND_DIST"

# Apply config from /data/options.json (if present)
if [[ -f "$DATA_DIR/options.json" ]]; then
    echo "[smartmarstek] Applying configuration from options.json..."
    python3 /app/setup_config.py
else
    echo "[smartmarstek] No options.json found (standalone mode)"
fi

# Start Flask backend
echo "[smartmarstek] Starting Flask backend on port 5000..."
cd /app/backend
exec python3 app.py
