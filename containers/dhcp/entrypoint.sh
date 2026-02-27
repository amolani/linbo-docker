#!/bin/sh
set -e

API_URL="${API_URL:-http://localhost:3000}"
LINBO_SERVER_IP="${LINBO_SERVER_IP:-10.0.0.1}"
DHCP_INTERFACE="${DHCP_INTERFACE:-eth0}"
INTERNAL_API_KEY="${INTERNAL_API_KEY:-linbo-internal-secret}"
CONFIG_DIR="/etc/dnsmasq.d"
CONFIG_FILE="${CONFIG_DIR}/linbo.conf"

echo "[DHCP] LINBO dnsmasq Proxy-DHCP Container"
echo "[DHCP] API URL: ${API_URL}"
echo "[DHCP] Server IP: ${LINBO_SERVER_IP}"
echo "[DHCP] Interface: ${DHCP_INTERFACE}"

# Create config directory
mkdir -p "${CONFIG_DIR}"

# Wait for API to be healthy
echo "[DHCP] Waiting for API to become healthy..."
MAX_RETRIES=30
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
  if curl -sf "${API_URL}/health" > /dev/null 2>&1; then
    echo "[DHCP] API is healthy"
    break
  fi
  RETRY=$((RETRY + 1))
  SLEEP=$((RETRY * 2))
  if [ $SLEEP -gt 10 ]; then
    SLEEP=10
  fi
  echo "[DHCP] API not ready, retrying in ${SLEEP}s... (${RETRY}/${MAX_RETRIES})"
  sleep $SLEEP
done

if [ $RETRY -eq $MAX_RETRIES ]; then
  echo "[DHCP] ERROR: API did not become healthy after ${MAX_RETRIES} retries"
  exit 1
fi

# Check for pre-generated config in shared volume
SHARED_CONFIG="/srv/linbo/dhcp/dnsmasq-proxy.conf"
if [ -f "${SHARED_CONFIG}" ]; then
  echo "[DHCP] Using pre-generated config from ${SHARED_CONFIG}"
  cp "${SHARED_CONFIG}" "${CONFIG_FILE}"
else
  # Fetch config from API using internal API key for authentication
  echo "[DHCP] Fetching proxy config from API..."

  # Try with API_TOKEN first (explicit token), then INTERNAL_API_KEY
  AUTH_TOKEN="${API_TOKEN:-${INTERNAL_API_KEY}}"

  HTTP_CODE=$(curl -sf -w "%{http_code}" \
    -H "Authorization: Bearer ${AUTH_TOKEN}" \
    -o "${CONFIG_FILE}" \
    "${API_URL}/api/v1/dhcp/export/dnsmasq-proxy?interface=${DHCP_INTERFACE}" 2>/dev/null || echo "000")

  if [ "${HTTP_CODE}" != "200" ] || [ ! -s "${CONFIG_FILE}" ]; then
    echo "[DHCP] WARNING: Could not fetch config from API (HTTP ${HTTP_CODE})"
    echo "[DHCP] Generating minimal proxy config..."

    cat > "${CONFIG_FILE}" <<EOF
# LINBO dnsmasq Proxy-DHCP - Minimal Config
# Could not fetch from API, using defaults
port=0
dhcp-range=10.0.0.0,proxy
interface=${DHCP_INTERFACE}
bind-interfaces
log-dhcp
dhcp-match=set:bios,option:client-arch,0
dhcp-match=set:efi32,option:client-arch,6
dhcp-match=set:efi64,option:client-arch,7
dhcp-match=set:efi64,option:client-arch,9
dhcp-boot=tag:bios,boot/grub/i386-pc/core.0,${LINBO_SERVER_IP}
dhcp-boot=tag:efi32,boot/grub/i386-efi/core.efi,${LINBO_SERVER_IP}
dhcp-boot=tag:efi64,boot/grub/x86_64-efi/core.efi,${LINBO_SERVER_IP}
EOF
  fi
fi

echo "[DHCP] Config written to ${CONFIG_FILE}"

# Start inotify watcher for live config reloads from sync.service
/watch-config.sh &
echo "[DHCP] Config watcher started (PID $!)"

echo "[DHCP] Starting dnsmasq..."
exec dnsmasq --no-daemon --conf-dir=/etc/dnsmasq.d --log-facility=-
