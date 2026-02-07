#!/bin/bash
#
# LINBO Docker - RSYNC Pre-Upload Hook
# Notifies API before upload starts
#
# Called by rsyncd before each upload operation
#

# API configuration
API_URL="${API_URL:-http://linbo-api:3000/api/v1}"
INTERNAL_API_KEY="${INTERNAL_API_KEY:-linbo-internal-secret}"

# Log file
LOGFILE="/var/log/rsync-hooks.log"

# Log helper
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [pre-upload] $*" >> "$LOGFILE"
}

log "Started: module=$RSYNC_MODULE_NAME client=$RSYNC_HOST_ADDR request=$RSYNC_REQUEST"

# Compute full file path (same logic as production rsync-pre-upload.sh)
FILE="${RSYNC_MODULE_PATH}/${RSYNC_REQUEST##$RSYNC_MODULE_NAME/}"
DIRNAME="$(dirname "$FILE")"
FILENAME=$(basename "$RSYNC_REQUEST")
EXT="${FILENAME##*.}"

# Traversal check: only mkdir under module path
if [[ "$DIRNAME" != "$RSYNC_MODULE_PATH"* ]]; then
    log "SECURITY: dirname $DIRNAME outside module path, skipping mkdir"
    exit 0
fi

# Create directory before rsync writes (production parity)
case "$EXT" in
    qcow2|qdiff|cloop)
        mkdir -p "$DIRNAME"
        log "Created image dir: $DIRNAME"
        ;;
    info|desc|torrent|macct|md5|reg|prestart|postsync)
        mkdir -p "$DIRNAME"
        ;;
esac

# Notify API
curl -s -X POST "${API_URL}/internal/rsync-event" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
    -d "{
        \"event\": \"pre-upload\",
        \"module\": \"${RSYNC_MODULE_NAME}\",
        \"clientIp\": \"${RSYNC_HOST_ADDR}\",
        \"request\": \"${RSYNC_REQUEST}\",
        \"filename\": \"${FILENAME}\"
    }" 2>/dev/null || log "Failed to notify API"

log "Completed: exit=$RSYNC_EXIT_STATUS"

exit $RSYNC_EXIT_STATUS
