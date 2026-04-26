#!/bin/sh
# FLUX Auto-Update Script
# Controleert op nieuwe commits op main, herbouwt en herstart bij wijzigingen.
# Gebruik: bash /flux/update.sh
# Cron:    */5 * * * * /bin/sh /flux/update.sh >> /flux/data/update.log 2>&1

set -e

INSTALL_DIR="${INSTALL_DIR:-/flux}"
REPO_BRANCH="main"
COMPOSE_CMD="docker compose"
LOG_PREFIX="[flux-update $(date '+%Y-%m-%d %H:%M:%S')]"

cd "$INSTALL_DIR"

# Fetch without merging to check for upstream changes
git fetch origin "$REPO_BRANCH" --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$REPO_BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
    exit 0
fi

echo "$LOG_PREFIX Nieuwe commits gevonden: $LOCAL → $REMOTE"
echo "$LOG_PREFIX Pull origin/$REPO_BRANCH..."
git pull origin "$REPO_BRANCH" --quiet

echo "$LOG_PREFIX Herbouwen Docker image..."
$COMPOSE_CMD build

echo "$LOG_PREFIX Services herstarten (zero-downtime: pull eerst)..."
$COMPOSE_CMD up -d --remove-orphans

echo "$LOG_PREFIX Update voltooid. Actieve containers:"
docker ps --format "  {{.Names}}: {{.Status}}" | grep -E "smartmarstek"

echo "$LOG_PREFIX Klaar."
