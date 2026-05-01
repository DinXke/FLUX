#!/bin/bash
# Validation script for PV Limiter functionality
# Checks: config, logs, SMA connectivity, and actual power limitation

set -e

DATA_DIR="${1:-/flux/data}"
LOG_DIR="${2:-/flux/logs}"
SMA_HOST="${3:-192.168.255.141}"
SMA_PORT="${4:-80}"

echo "🔍 PV Limiter Validation Script"
echo "================================"
echo ""

# 1. Check configuration file
echo "1️⃣  Checking configuration..."
CONFIG="$DATA_DIR/strategy_settings.json"

if [ ! -f "$CONFIG" ]; then
    echo "❌ Config file not found: $CONFIG"
    exit 1
fi

ENABLED=$(jq -r '.pv_limiter_enabled // false' "$CONFIG")
OVERRIDE=$(jq -r '.pv_limiter_manual_override // false' "$CONFIG")
MANUAL_W=$(jq -r '.pv_limiter_manual_w // 0' "$CONFIG")

echo "   pv_limiter_enabled: $ENABLED"
echo "   pv_limiter_manual_override: $OVERRIDE"
echo "   pv_limiter_manual_w: $MANUAL_W W"

if [ "$ENABLED" != "true" ] || [ "$OVERRIDE" != "true" ]; then
    echo "⚠️  WARNING: PV Limiter not enabled or manual override disabled!"
fi

echo ""
echo "2️⃣  Checking recent logs..."

if [ ! -d "$LOG_DIR" ]; then
    echo "⚠️  Log directory not found: $LOG_DIR"
else
    # Look for WebUI PV-limiter messages
    RECENT=$(find "$LOG_DIR" -type f -name "*.log" -mmin -5 2>/dev/null | \
             xargs grep -h "WebUI PV-limiter" 2>/dev/null | tail -3)

    if [ -n "$RECENT" ]; then
        echo "   Found recent PV-limiter activity:"
        echo "$RECENT" | sed 's/^/     /'
    else
        echo "   ℹ️  No recent PV-limiter activity found (may not have run yet)"
    fi
fi

echo ""
echo "3️⃣  Checking SMA Sunny Boy connectivity..."

# Try to reach SMA WebUI
if timeout 5 bash -c "echo > /dev/tcp/$SMA_HOST/$SMA_PORT" 2>/dev/null; then
    echo "   ✅ SMA WebUI reachable at $SMA_HOST:$SMA_PORT"
else
    echo "   ❌ Cannot reach SMA at $SMA_HOST:$SMA_PORT"
    echo "      Check SMA_IP and network connectivity"
fi

echo ""
echo "4️⃣  Testing WebUI API (manual test)..."
echo "   To test manually:"
echo "   1. Check SMA WebUI: http://$SMA_HOST/dyn/getValues.json?id=6802_00832B00"
echo "   2. View current power limit in SMA WebUI"
echo "   3. Wait 30s for strategy to run"
echo "   4. Check logs: tail -f $LOG_DIR/*.log | grep PV-limiter"
echo "   5. Verify limit changed in SMA WebUI"

echo ""
echo "================================"
echo "✅ Validation complete!"
echo ""
echo "If PV Limiter still not working:"
echo "  - Check backend logs for errors"
echo "  - Verify SMA_IP environment variable is set"
echo "  - Ensure SMA WebUI is accessible"
echo "  - Check if only 1 session can be active on SMA"
