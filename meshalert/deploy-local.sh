#!/bin/bash
# MeshAlert local deployment (voor executie op server waar FLUX staat)

set -euo pipefail

DEPLOY_PATH="/flux"
MESHALERT_PATH="$DEPLOY_PATH/meshalert"

echo "=== MeshAlert Local Deployment ==="
echo "Path: $MESHALERT_PATH"

# 1. Verify paths exist
if [ ! -d "$DEPLOY_PATH" ]; then
  echo "ERROR: $DEPLOY_PATH does not exist"
  exit 1
fi

# 2. Navigate to meshalert
cd "$MESHALERT_PATH"
echo "✓ In $MESHALERT_PATH"

# 3. Verify .env exists
if [ ! -f ".env" ]; then
  echo "ERROR: .env not found. Copy from .env.example first"
  exit 1
fi

# 4. Create data directory
echo "Setting up data directory..."
mkdir -p "$MESHALERT_PATH/data"
chmod 755 "$MESHALERT_PATH/data"

# 5. Start MeshAlert service
echo "Building and starting MeshAlert..."
docker compose up -d --build

# 6. Wait and health check
echo "Waiting for service..."
sleep 5

echo "Health checks..."
for i in {1..10}; do
  if curl -sf http://localhost:7842/api/repeaters > /dev/null 2>&1; then
    echo "✓ MeshAlert is running!"
    echo ""
    echo "=== Deployment Successful ==="
    echo "Dashboard: http://localhost:7842"
    echo "API Health: curl http://localhost:7842/api/repeaters"
    exit 0
  fi

  if [ $i -lt 10 ]; then
    echo "Health check $i/10..."
    sleep 2
  fi
done

echo "⚠ Service may still be starting. Check logs:"
echo "  docker compose logs -f meshalert"
exit 1
