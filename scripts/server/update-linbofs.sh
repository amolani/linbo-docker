#!/bin/bash
#
# LINBO Docker - Update-Linbofs Script
# Injects SSH-Keys and RSYNC-Password hash into linbofs64
#
# Based on the original linuxmuster.net update-linbofs script
# Adapted for LINBO Docker standalone solution
#

set -e

# =============================================================================
# Configuration
# =============================================================================

LINBO_DIR="${LINBO_DIR:-/srv/linbo}"
CONFIG_DIR="${CONFIG_DIR:-/etc/linuxmuster/linbo}"
CACHE_DIR="/var/cache/linbo"
WORK_DIR="$CACHE_DIR/linbofs-update"

# Files
LINBOFS="$LINBO_DIR/linbofs64"
RSYNC_SECRETS="${RSYNC_SECRETS:-/etc/rsyncd.secrets}"

echo "=== LINBO Docker Update-Linbofs ==="
echo "Date: $(date)"
echo ""

# =============================================================================
# Lockfile handling
# =============================================================================

LOCKER="/tmp/.update-linbofs.lock"
if [ -e "$LOCKER" ]; then
    echo "ERROR: Another update-linbofs process is running!"
    echo "If this is not the case, remove the lockfile: $LOCKER"
    exit 1
fi
touch "$LOCKER"
chmod 400 "$LOCKER"
trap "rm -f $LOCKER" EXIT

# =============================================================================
# Validate prerequisites
# =============================================================================

# Check for linbofs64
if [ ! -f "$LINBOFS" ]; then
    echo "ERROR: $LINBOFS not found!"
    echo "Please ensure linbofs64 is present in $LINBO_DIR"
    exit 1
fi

# Check for rsync secrets
if [ ! -s "$RSYNC_SECRETS" ]; then
    echo "ERROR: $RSYNC_SECRETS not found or empty!"
    exit 1
fi

# Check for required tools
for tool in xz cpio argon2; do
    if ! command -v $tool &> /dev/null; then
        echo "ERROR: Required tool '$tool' not found!"
        exit 1
    fi
done

# =============================================================================
# Step 1: Read and hash RSYNC password
# =============================================================================

linbo_passwd="$(grep ^linbo "$RSYNC_SECRETS" | awk -F: '{print $2}')"
if [ -z "$linbo_passwd" ]; then
    echo "ERROR: Cannot read linbo password from $RSYNC_SECRETS!"
    exit 1
fi

echo -n "Hashing linbo password... "
linbo_salt="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"
linbo_pwhash="$(echo "$linbo_passwd" | argon2 "$linbo_salt" -t 1000 | grep ^Hash | awk '{print $2}')"

if [ -z "$linbo_pwhash" ] || [ -z "$linbo_salt" ]; then
    echo "FAILED"
    echo "ERROR: Password hashing failed!"
    exit 1
fi
echo "OK"

# =============================================================================
# Step 2: Prepare work directory
# =============================================================================

echo "Preparing work directory..."
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

# =============================================================================
# Step 3: Create backup
# =============================================================================

echo "Creating backup: ${LINBOFS}.bak"
cp "$LINBOFS" "${LINBOFS}.bak"

# =============================================================================
# Step 4: Extract linbofs64
# =============================================================================

echo "Extracting linbofs64..."
xzcat "$LINBOFS" | cpio -i -d -H newc --no-absolute-filenames 2>/dev/null
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to extract linbofs64!"
    exit 1
fi

# =============================================================================
# Step 5: Inject password hash
# =============================================================================

echo "Injecting password hash..."
echo -n "$linbo_pwhash" > etc/linbo_pwhash
echo -n "$linbo_salt" > etc/linbo_salt
chmod 600 etc/linbo_*
echo "  - Password hash injected"

# =============================================================================
# Step 6: Inject SSH keys
# =============================================================================

echo "Injecting SSH keys..."

# Create required directories
mkdir -p etc/dropbear etc/ssh .ssh var/log
touch var/log/lastlog

# Dropbear host keys
DROPBEAR_KEYS=0
if ls "$CONFIG_DIR"/dropbear_*_host_key 1>/dev/null 2>&1; then
    cp "$CONFIG_DIR"/dropbear_*_host_key etc/dropbear/
    DROPBEAR_KEYS=$(ls etc/dropbear/*.host_key 2>/dev/null | wc -l)
    echo "  - Dropbear keys injected: $DROPBEAR_KEYS"
fi

# OpenSSH host keys
SSH_KEYS=0
if ls "$CONFIG_DIR"/ssh_host_*_key* 1>/dev/null 2>&1; then
    cp "$CONFIG_DIR"/ssh_host_*_key* etc/ssh/
    SSH_KEYS=$(ls etc/ssh/ssh_host_*_key 2>/dev/null | wc -l)
    echo "  - SSH host keys injected: $SSH_KEYS"
fi

# Authorized keys (public keys for server -> client SSH)
AUTH_KEYS=0
if ls "$CONFIG_DIR"/*.pub 1>/dev/null 2>&1; then
    cat "$CONFIG_DIR"/*.pub > .ssh/authorized_keys
    chmod 600 .ssh/authorized_keys
    AUTH_KEYS=$(wc -l < .ssh/authorized_keys)
    echo "  - Authorized keys injected: $AUTH_KEYS"
fi

# Also check /root/.ssh for authorized keys (compatibility with linuxmuster.net)
if [ -f /root/.ssh/id_rsa.pub ] || [ -f /root/.ssh/id_ed25519.pub ]; then
    cat /root/.ssh/id_*.pub >> .ssh/authorized_keys 2>/dev/null
    chmod 600 .ssh/authorized_keys
    echo "  - Added server keys from /root/.ssh"
fi

# Ensure correct permissions
chmod 700 .ssh 2>/dev/null || true

# =============================================================================
# Step 7: Copy default start.conf
# =============================================================================

if [ -f "$LINBO_DIR/start.conf" ]; then
    cp "$LINBO_DIR/start.conf" .
    echo "  - Default start.conf copied"
fi

# =============================================================================
# Step 8: Repack linbofs64
# =============================================================================

echo "Repacking linbofs64 (this may take a while)..."
find . -print | cpio --quiet -o -H newc | xz -e --check=none -z -f -T 0 -c > "$LINBOFS.new"

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to repack linbofs64!"
    exit 1
fi

# =============================================================================
# Step 9: Verify new file
# =============================================================================

NEW_SIZE=$(stat -c%s "$LINBOFS.new")
OLD_SIZE=$(stat -c%s "${LINBOFS}.bak")

echo "Verifying new linbofs64..."
echo "  - Old size: $OLD_SIZE bytes"
echo "  - New size: $NEW_SIZE bytes"

# Sanity check: new file shouldn't be drastically smaller
MIN_SIZE=$((OLD_SIZE / 2))
if [ "$NEW_SIZE" -lt "$MIN_SIZE" ]; then
    echo "ERROR: New file is suspiciously small ($NEW_SIZE bytes)"
    echo "Keeping backup, aborting!"
    rm -f "$LINBOFS.new"
    exit 1
fi

# =============================================================================
# Step 10: Replace original file
# =============================================================================

echo "Replacing original linbofs64..."
mv "$LINBOFS.new" "$LINBOFS"

# =============================================================================
# Step 11: Generate MD5 hash
# =============================================================================

echo "Generating MD5 hash..."
md5sum "$LINBOFS" | awk '{print $1}' > "${LINBOFS}.md5"
echo "  - MD5: $(cat ${LINBOFS}.md5)"

# =============================================================================
# Step 12: Cleanup
# =============================================================================

echo "Cleaning up..."
rm -rf "$WORK_DIR"

# =============================================================================
# Summary
# =============================================================================

echo ""
echo "=== Update-Linbofs completed successfully ==="
echo "File: $LINBOFS"
echo "Size: $NEW_SIZE bytes"
echo "Keys: Dropbear=$DROPBEAR_KEYS, SSH=$SSH_KEYS, Authorized=$AUTH_KEYS"
echo ""
