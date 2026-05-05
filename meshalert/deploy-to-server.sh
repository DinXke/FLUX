#!/bin/bash
# MeshAlert deployment script voor FLUX server (10.10.30.112)
# Uitvoering: ssh flux@10.10.30.112 'bash -s' < deploy-to-server.sh

set -euo pipefail

DEPLOY_PATH="/flux"
MESHALERT_PATH="$DEPLOY_PATH/meshalert"
SERVER_USER="flux"
SERVER_HOST="10.10.30.112"

echo "=== MeshAlert Deployment to $SERVER_HOST ==="

# 1. Pull latest code
echo "Step 1: Pulling latest code from GitHub..."
cd "$DEPLOY_PATH"
git pull origin main

# 2. Configure .env with Telegram credentials
echo "Step 2: Configuring environment..."
cd "$MESHALERT_PATH"
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "✓ .env created from example"
fi

# Update Telegram credentials from Communication project
sed -i 's|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=766612257:AAHcuAzSxSN3BM_n1uviJe-aXNo3IrRgR7w|' .env
sed -i 's|^TELEGRAM_CHAT_ID=.*|TELEGRAM_CHAT_ID=-|' .env
sed -i 's|^CORESCOPE_WS_URL=.*|CORESCOPE_WS_URL=wss://analyzer.on8ar.eu/|' .env
echo "✓ .env configured with Telegram + CoReScope credentials"

# 3. Create data directory
echo "Step 3: Setting up data directory..."
mkdir -p "$MESHALERT_PATH/data"
chmod 755 "$MESHALERT_PATH/data"

# 4. Start MeshAlert service
echo "Step 4: Building and starting MeshAlert service..."
cd "$MESHALERT_PATH"
docker compose up -d --build meshalert

# 5. Wait and health check
echo "Step 5: Waiting for service to stabilize..."
sleep 5

echo "Step 6: Running health checks..."
for i in {1..10}; do
  if curl -sf http://localhost:7842/api/repeaters > /dev/null 2>&1; then
    echo "✓ Service health check passed!"
    echo ""
    echo "=== Deployment Complete ==="
    echo "MeshAlert is running at http://10.10.30.112:7842"
    echo "Dashboard: http://10.10.30.112:7842"
    echo "Health: curl http://10.10.30.112:7842/api/repeaters"
    echo "SSE Stream: curl -N http://10.10.30.112:7842/api/detections/stream"
    exit 0
  fi

  if [ $i -lt 10 ]; then
    echo "Health check attempt $i/10... waiting..."
    sleep 2
  fi
done

echo "⚠ Service may still be starting. Check logs with:"
echo "  docker logs -f flux-meshalert-1"
exit 1
