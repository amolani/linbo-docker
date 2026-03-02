#!/bin/bash
# LINBO Docker — Deploy to remote server
# Usage: ./scripts/deploy.sh <target-host> [--rebuild]
#
# Deploys code from this repo to the target server.
# The .env on the target is NEVER overwritten (standort-spezifisch).

set -e

TARGET=${1:?Usage: $0 <target-host> [--rebuild]}
REBUILD=${2:-}
REMOTE_DIR="/root/linbo-docker"
COMPOSE_FILE="${REMOTE_DIR}/docker-compose.yml"

echo "=== Deploying to $TARGET ==="

# 1. Sync code (exclude .env, node_modules, volumes)
rsync -avz --delete \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'docs/bilder' \
  -e ssh \
  /root/linbo-docker/ ${TARGET}:${REMOTE_DIR}/

# 2. Rebuild containers (use -f flag — cd may not work in all SSH contexts)
ssh $TARGET "docker compose -f $COMPOSE_FILE up -d --build api web"

# 3. Optional: Rebuild linbofs + regenerate GRUB via API
if [ "$REBUILD" = "--rebuild" ]; then
  echo "=== Rebuilding linbofs64 (via API) ==="

  # Get auth token (heredoc for safe JSON escaping)
  TOKEN=$(ssh $TARGET 'curl -sf -X POST http://localhost:3000/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"admin\",\"password\":\"Muster!\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)[\"token\"])"')

  if [ -z "$TOKEN" ]; then
    echo "ERROR: Failed to get API token — falling back to direct exec"
    echo "(Auto-detect will still protect host kernel)"
    ssh $TARGET "docker exec linbo-api /usr/share/linuxmuster/linbo/update-linbofs.sh"
  else
    # Rebuild linbofs64 via API (sets USE_HOST_KERNEL + SKIP_KERNEL_COPY automatically)
    echo "  POST /system/update-linbofs ..."
    ssh $TARGET "curl -sf -X POST http://localhost:3000/api/v1/system/update-linbofs \
      -H 'Authorization: Bearer $TOKEN' \
      -H 'Content-Type: application/json'" \
      && echo "  linbofs64 rebuild OK" \
      || echo "  WARNING: linbofs64 rebuild failed (check API logs)"

    # Regenerate GRUB configs via API
    echo "  POST /system/regenerate-grub-configs ..."
    ssh $TARGET "curl -sf -X POST http://localhost:3000/api/v1/system/regenerate-grub-configs \
      -H 'Authorization: Bearer $TOKEN'" \
      && echo "  GRUB regeneration OK" \
      || echo "  WARNING: GRUB regeneration failed (check API logs)"
  fi

  echo "=== Restarting TFTP ==="
  ssh $TARGET "docker compose -f $COMPOSE_FILE restart tftp"
fi

echo "=== Deploy complete ==="
