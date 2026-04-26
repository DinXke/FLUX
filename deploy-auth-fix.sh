#!/usr/bin/env bash
#
# Deploy FLUX auth fix (SCH-771) to test server
# Usage: ssh user@10.10.30.112 'bash deploy-auth-fix.sh'
#

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

log_info()  { echo -e "${GREEN}[✓]${RESET} $*"; }
log_err()   { echo -e "${RED}[✗]${RESET} $*" >&2; }
log_title() { echo -e "\n${YELLOW}=== $* ===${RESET}"; }

# Verify we're in /flux
if [[ ! -d "/flux" ]]; then
    log_err "Not found: /flux directory. Are you on the deployment server?"
    exit 1
fi

cd /flux

log_title "Step 1: Pull latest code from main branch"
git pull origin main
log_info "Code updated"

log_title "Step 2: Configure AUTH_ENABLED in .env"
if grep -q "^AUTH_ENABLED=" .env 2>/dev/null; then
    log_info ".env already has AUTH_ENABLED, updating to true"
    sed -i 's/^AUTH_ENABLED=.*/AUTH_ENABLED=true/' .env
else
    log_info ".env missing AUTH_ENABLED, adding..."
    echo "AUTH_ENABLED=true" >> .env
fi

log_info "AUTH_ENABLED setting:"
grep "^AUTH_ENABLED=" .env || echo "NOT FOUND"

log_title "Step 3: Rebuild and restart Docker containers"
docker compose up -d --build
log_info "Containers rebuilt and restarted"

log_title "Step 4: Verify deployment"
sleep 3  # Wait for containers to be ready

echo "Testing /api/auth/me without token (expect 401):"
curl -sk https://127.0.0.1/api/auth/me 2>/dev/null | head -c 100 || echo "(curl failed - check HTTPS cert)"

echo -e "\n\nTesting /api/users without token (expect 401):"
curl -sk https://127.0.0.1/api/users 2>/dev/null | head -c 100 || echo "(curl failed - check HTTPS cert)"

log_title "Deployment complete"
log_info "Run full QA tests on https://10.10.30.112"
