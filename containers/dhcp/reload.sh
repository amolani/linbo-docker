#!/bin/sh
set -e

CONFIG_DIR="/etc/dnsmasq.d"
CONFIG_FILE="${CONFIG_DIR}/linbo.conf"
SHARED_CONFIG="/srv/linbo/dhcp/dnsmasq-proxy.conf"

echo "[DHCP-Reload] Reloading dnsmasq proxy config..."

# Check for updated config in shared volume
if [ -f "${SHARED_CONFIG}" ]; then
  echo "[DHCP-Reload] Using config from shared volume"
  cp "${SHARED_CONFIG}" "${CONFIG_FILE}"
  echo "[DHCP-Reload] Config updated, sending SIGHUP to dnsmasq..."
  killall -HUP dnsmasq 2>/dev/null || echo "[DHCP-Reload] WARNING: Could not signal dnsmasq"
  echo "[DHCP-Reload] Done"
else
  echo "[DHCP-Reload] No config found at ${SHARED_CONFIG}"
  echo "[DHCP-Reload] Use 'POST /api/v1/dhcp/reload-proxy' to generate config first"
  exit 1
fi
