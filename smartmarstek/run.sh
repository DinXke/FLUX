#!/usr/bin/with-contenv bashio
# ==============================================================================
# SmartMarstek – add-on startup script
# ==============================================================================

bashio::log.info "Starting SmartMarstek..."

# ── Log level ──────────────────────────────────────────────────────────────
LOG_LEVEL=$(bashio::config 'log_level')
export LOG_LEVEL="${LOG_LEVEL:-info}"
bashio::log.info "Log level: ${LOG_LEVEL}"

# ── Persistent data directory (/data survives add-on updates) ─────────────
export MARSTEK_DATA_DIR="/data"
mkdir -p "${MARSTEK_DATA_DIR}"
bashio::log.info "Data directory: ${MARSTEK_DATA_DIR}"

# ── Frontend dist (built into the image) ──────────────────────────────────
export MARSTEK_FRONTEND_DIST="/app/frontend/dist"

# ── Start Flask backend ────────────────────────────────────────────────────
bashio::log.info "Starting SmartMarstek backend on port 5000..."
cd /app/backend
exec python3 app.py
