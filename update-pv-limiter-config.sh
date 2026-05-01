#!/bin/bash
# Helper script to enable PV Limiter settings on the FLUX server

set -e

CONFIG_FILE="${1:-/flux/data/strategy_settings.json}"
MANUAL_W="${2:-1800}"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Config file not found: $CONFIG_FILE"
    exit 1
fi

echo "📝 Updating PV Limiter settings in: $CONFIG_FILE"
echo "   - pv_limiter_enabled: true"
echo "   - pv_limiter_manual_override: true"
echo "   - pv_limiter_manual_w: $MANUAL_W"

# Use jq to safely update JSON
jq \
    --arg enabled "true" \
    --arg override "true" \
    --arg watts "$MANUAL_W" \
    '.pv_limiter_enabled = ($enabled == "true") |
     .pv_limiter_manual_override = ($override == "true") |
     .pv_limiter_manual_w = ($watts | tonumber)' \
    "$CONFIG_FILE" > "$CONFIG_FILE.tmp"

mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
echo "✅ Config updated successfully"
echo ""
echo "🔄 Backend will auto-reload config in next cycle (max 30s)"
echo "📊 Check logs: tail -f /flux/logs/*.log | grep 'PV-limiter'"
