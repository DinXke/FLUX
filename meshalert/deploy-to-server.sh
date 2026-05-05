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

# 2. Copy .env if not present
echo "Step 2: Checking environment configuration..."
if [ ! -f "$MESHALERT_PATH/.env" ]; then
  echo "Creating .env from .env.example..."
  cd "$MESHALERT_PATH"
  cp .env.example .env
  echo "⚠ .env created with defaults. Please edit with Telegram token + CoReScope URL"
else
  echo "✓ .env already exists"
fi

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
