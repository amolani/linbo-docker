#!/bin/bash
#
# LINBO Docker - Update-Linbofs Script
# Injects SSH-Keys, RSYNC-Password hash, and selected kernel modules into linbofs64
#
# Based on the original linuxmuster.net update-linbofs script
# Adapted for LINBO Docker standalone solution with kernel variant support
#

set -e

# =============================================================================
# Configuration
# =============================================================================

LINBO_DIR="${LINBO_DIR:-/srv/linbo}"
CONFIG_DIR="${CONFIG_DIR:-/etc/linuxmuster/linbo}"
CACHE_DIR="/var/cache/linbo"
KERNEL_VAR_DIR="${KERNEL_VAR_DIR:-/var/lib/linuxmuster/linbo/current}"

# Files
LINBOFS="$LINBO_DIR/linbofs64"
RSYNC_SECRETS="${RSYNC_SECRETS:-/etc/rsyncd.secrets}"
CUSTOM_KERNEL_FILE="$CONFIG_DIR/custom_kernel"
LINBOFS_TEMPLATE="$KERNEL_VAR_DIR/linbofs64.xz"

echo "=== LINBO Docker Update-Linbofs ==="
echo "Date: $(date)"
echo ""

# =============================================================================
# Lockfile handling (flock-based for shared volume safety)
# =============================================================================

REBUILD_LOCK="${CONFIG_DIR}/.rebuild.lock"
exec 8>"$REBUILD_LOCK"
if ! flock -n 8; then
    echo "ERROR: Another update-linbofs process is running!"
    echo "If this is not the case, the lock will be released when the process exits."
    exit 1
fi
# Lock is held until script exits (fd 8 is closed automatically)

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
# Step 1: Read kernel variant from custom_kernel
# =============================================================================

KTYPE="stable"

if [ -s "$CUSTOM_KERNEL_FILE" ]; then
    # Tolerant parsing: ignore comments, quotes, whitespace, take last KERNELPATH=
    KPATH=$(grep -E '^[[:space:]]*KERNELPATH=' "$CUSTOM_KERNEL_FILE" 2>/dev/null | tail -1 | sed 's/.*=//;s/[" ]//g')
    case "$KPATH" in
        legacy|longterm|stable) KTYPE="$KPATH" ;;
        "") KTYPE="stable" ;;
        *) echo "ERROR: Invalid KERNELPATH '$KPATH' in custom_kernel"; exit 1 ;;
    esac
fi

echo "Kernel variant: $KTYPE"

# =============================================================================
# Step 2: Validate kernel variant directory (if available)
# =============================================================================

VARIANT_DIR="$KERNEL_VAR_DIR/$KTYPE"
HAS_KERNEL_VARIANT=false

if [ -d "$VARIANT_DIR" ]; then
    MISSING_VARIANT_FILES=""
    for f in linbo64 modules.tar.xz version; do
        if [ ! -f "$VARIANT_DIR/$f" ]; then
            MISSING_VARIANT_FILES="$MISSING_VARIANT_FILES $f"
        fi
    done

    if [ -n "$MISSING_VARIANT_FILES" ]; then
        echo "WARNING: Incomplete variant '$KTYPE': missing$MISSING_VARIANT_FILES"
        echo "Proceeding without kernel module injection"
    else
        HAS_KERNEL_VARIANT=true
        KVERS=$(cat "$VARIANT_DIR/version")
        echo "Kernel version: $KVERS"
    fi
else
    echo "INFO: Kernel variant directory not found ($VARIANT_DIR)"
    echo "Proceeding without kernel module injection"
    echo "(This is normal for setups without kernel variant provisioning)"
fi

# =============================================================================
# Step 3: Read and hash RSYNC password
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
# Step 4: Prepare work directory (unique per run)
# =============================================================================

WORKDIR=$(mktemp -d "${CACHE_DIR}/linbofs-build.XXXXXX")
trap "rm -rf $WORKDIR" EXIT

echo "Work directory: $WORKDIR"

# =============================================================================
# Step 5: Create backup
# =============================================================================

echo "Creating backup: ${LINBOFS}.bak"
cp "$LINBOFS" "${LINBOFS}.bak"

# =============================================================================
# Step 6: Extract linbofs64 template or current linbofs64
# =============================================================================

cd "$WORKDIR"

if [ -f "$LINBOFS_TEMPLATE" ]; then
    echo "Extracting linbofs template (linbofs64.xz)..."
    xzcat "$LINBOFS_TEMPLATE" | cpio -i -d -H newc --no-absolute-filenames 2>/dev/null
else
    echo "WARNING: linbofs64.xz template not found, using current linbofs64"
    xzcat "$LINBOFS" | cpio -i -d -H newc --no-absolute-filenames 2>/dev/null
fi

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to extract linbofs!"
    exit 1
fi

# =============================================================================
# Step 7: Inject kernel modules (if variant available)
# =============================================================================

if [ "$HAS_KERNEL_VARIANT" = "true" ]; then
    echo "Injecting kernel modules from variant '$KTYPE'..."

    # Ensure lib/modules exists
    mkdir -p lib/modules
    # Remove old modules completely
    rm -rf lib/modules/*

    # Tar safety: check for path traversal
    if tar tf "$VARIANT_DIR/modules.tar.xz" | grep -qE '(^/|\.\.)'; then
        echo "ERROR: modules.tar.xz contains absolute paths or .. segments — refusing to extract"
        exit 1
    fi

    # Extract modules
    tar xf "$VARIANT_DIR/modules.tar.xz" --no-absolute-filenames

    # Validate: exactly one lib/modules/<kver> directory
    MOD_DIRS=$(ls -d lib/modules/*/ 2>/dev/null | wc -l)
    if [ "$MOD_DIRS" -ne 1 ]; then
        echo "ERROR: Expected exactly 1 modules directory, found $MOD_DIRS"
        exit 1
    fi

    MOD_KVER=$(basename $(ls -d lib/modules/*/))

    # Sanity check on module version format
    if [ -z "$MOD_KVER" ] || [ ${#MOD_KVER} -lt 3 ] || ! echo "$MOD_KVER" | grep -qE '^[0-9]+\.'; then
        echo "ERROR: Suspicious module version '$MOD_KVER' — expected format like '6.12.57'"
        exit 1
    fi

    echo "  - Modules: $MOD_KVER (variant version: $KVERS)"

    # Verify modules extracted successfully
    if [ ! -d "lib/modules" ] || [ -z "$(ls -A lib/modules/ 2>/dev/null)" ]; then
        echo "ERROR: No lib/modules/ found after extracting modules.tar.xz — archive may be corrupt"
        exit 1
    fi

    # Run depmod if available
    if command -v depmod &>/dev/null; then
        depmod -a -b . "$MOD_KVER"
        echo "  - depmod completed"
    fi
fi

# =============================================================================
# Step 8: Inject password hash
# =============================================================================

echo "Injecting password hash..."
mkdir -p etc
echo -n "$linbo_pwhash" > etc/linbo_pwhash
echo -n "$linbo_salt" > etc/linbo_salt
chmod 600 etc/linbo_*
echo "  - Password hash injected"

# =============================================================================
# Step 9: Inject SSH keys
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
# Step 10: Copy default start.conf
# =============================================================================

if [ -f "$LINBO_DIR/start.conf" ]; then
    cp "$LINBO_DIR/start.conf" .
    echo "  - Default start.conf copied"
fi

# =============================================================================
# Step 11: Repack linbofs64
# =============================================================================

echo "Repacking linbofs64 (this may take a while)..."
find . -print | cpio --quiet -o -H newc | xz -e --check=none -z -f -T 0 -c > "$LINBOFS.new"

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to repack linbofs64!"
    exit 1
fi

# =============================================================================
# Step 12: Verify new file
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
# Step 13: Replace original file
# =============================================================================

echo "Replacing original linbofs64..."
mv "$LINBOFS.new" "$LINBOFS"

# =============================================================================
# Step 14: Generate MD5 hash
# =============================================================================

echo "Generating MD5 hash..."
md5sum "$LINBOFS" | awk '{print $1}' > "${LINBOFS}.md5"
echo "  - MD5: $(cat ${LINBOFS}.md5)"

# =============================================================================
# Step 15: Copy kernel from variant (if available)
# =============================================================================

if [ "$HAS_KERNEL_VARIANT" = "true" ]; then
    echo "Copying kernel from variant '$KTYPE'..."
    cp "$VARIANT_DIR/linbo64" "$LINBO_DIR/linbo64"
    md5sum "$LINBO_DIR/linbo64" | awk '{print $1}' > "$LINBO_DIR/linbo64.md5"
    echo "  - linbo64: $(cat $LINBO_DIR/linbo64.md5)"
fi

# =============================================================================
# Summary
# =============================================================================

echo ""
echo "=== Update-Linbofs completed successfully ==="
echo "File: $LINBOFS"
echo "Size: $NEW_SIZE bytes"
echo "Keys: Dropbear=$DROPBEAR_KEYS, SSH=$SSH_KEYS, Authorized=$AUTH_KEYS"
if [ "$HAS_KERNEL_VARIANT" = "true" ]; then
    echo "Kernel: $KTYPE ($KVERS)"
fi
echo ""
