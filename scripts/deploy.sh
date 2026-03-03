#!/bin/bash
# LINBO Docker — Deploy to remote server
# Usage: ./scripts/deploy.sh <target-host> [--rebuild] [--git]
#
# Deploys code from this repo to the target server.
# The .env on the target is NEVER overwritten (standort-spezifisch).
#
# Options:
#   --rebuild   Also rebuild linbofs64 and regenerate GRUB configs
#   --git       Use git pull instead of rsync (requires clean working tree on target)

set -e

TARGET=${1:?Usage: $0 <target-host> [--rebuild] [--git]}
shift
REBUILD=""
USE_GIT=""
for arg in "$@"; do
  case "$arg" in
    --rebuild) REBUILD=1 ;;
    --git)     USE_GIT=1 ;;
  esac
done

REMOTE_DIR="/root/linbo-docker"
COMPOSE_FILE="${REMOTE_DIR}/docker-compose.yml"

echo "=== Deploying to $TARGET ==="

if [ -n "$USE_GIT" ]; then
  # Git-based deploy: push to origin, pull on target
  echo "--- Git push + pull ---"
  git push origin main
  ssh "$TARGET" "cd ${REMOTE_DIR}; git fetch origin; git reset --hard origin/main"
else
  # rsync-based deploy: sync code (exclude .env, node_modules, volumes)
  echo "--- rsync ---"
  rsync -avz --delete \
    --exclude '.env' \
    --exclude '.env.local' \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'docs/bilder' \
    -e ssh \
    /root/linbo-docker/ "${TARGET}:${REMOTE_DIR}/"
fi

# Rebuild containers (use -f flag — cd may not work in all SSH contexts)
echo "--- Rebuilding containers ---"
ssh "$TARGET" "GITHUB_TOKEN=\$(grep GITHUB_TOKEN ${REMOTE_DIR}/.env 2>/dev/null | cut -d= -f2) docker compose -f $COMPOSE_FILE up -d --build api web"

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
