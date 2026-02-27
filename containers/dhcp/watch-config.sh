#!/bin/sh
# inotify-based config watcher for dnsmasq
# Watches /srv/linbo/dhcp/dnsmasq-proxy.conf for changes written by sync.service.js
# On change: copies to /etc/dnsmasq.d/linbo.conf and sends SIGHUP to dnsmasq

SHARED_CONFIG="/srv/linbo/dhcp/dnsmasq-proxy.conf"
CONFIG_FILE="/etc/dnsmasq.d/linbo.conf"

# Wait until the shared config file exists
while [ ! -f "$SHARED_CONFIG" ]; do
  echo "[DHCP-Watch] Waiting for ${SHARED_CONFIG} ..."
  sleep 5
done

echo "[DHCP-Watch] Watching ${SHARED_CONFIG} for changes..."

# Watch for close_write (atomic rename lands as moved_to in the parent dir)
while inotifywait -e close_write,moved_to "$(dirname "$SHARED_CONFIG")" 2>/dev/null; do
  if [ -f "$SHARED_CONFIG" ]; then
    echo "[DHCP-Watch] Config changed, reloading dnsmasq..."
    cp "$SHARED_CONFIG" "$CONFIG_FILE"
    killall -HUP dnsmasq 2>/dev/null || true
  fi
done
