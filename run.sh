#!/usr/bin/with-contenv bashio
# ==============================================================================
# SmartMarstek – Home Assistant add-on startup script
# ==============================================================================

# ── Log level (from add-on Configuration tab) ─────────────────────────────
LOG_LEVEL=$(bashio::config 'log_level' 'info')
bashio::log.level "${LOG_LEVEL}"
export MARSTEK_LOG_LEVEL="${LOG_LEVEL}"

bashio::log.info "Starting SmartMarstek v$(bashio::addon.version)..."

# ── Persistent data directory ─────────────────────────────────────────────
export MARSTEK_DATA_DIR="/data"
export MARSTEK_FRONTEND_DIST="/app/frontend/dist"
mkdir -p "${MARSTEK_DATA_DIR}"

# ── Apply add-on config tab settings to data JSON files ──────────────────
bashio::log.info "Applying add-on configuration..."
python3 /app/setup_config.py

# ── Start Flask backend ────────────────────────────────────────────────────
bashio::log.info "Starting backend on port 5000..."
cd /app/backend
exec python3 app.py
