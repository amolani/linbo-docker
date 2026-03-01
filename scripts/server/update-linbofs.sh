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

# Host kernel support (set by linbo-update.service.js)
USE_HOST_KERNEL="${USE_HOST_KERNEL:-false}"
HOST_MODULES_PATH_OVERRIDE="${HOST_MODULES_PATH:-}"
SKIP_KERNEL_COPY="${SKIP_KERNEL_COPY:-false}"

# Files
LINBOFS="$LINBO_DIR/linbofs64"
RSYNC_SECRETS="${RSYNC_SECRETS:-$CONFIG_DIR/rsyncd.secrets}"
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
    xzcat "$LINBOFS_TEMPLATE" | cpio -i -d -H newc --no-absolute-filenames 2>/dev/null || true
else
    echo "WARNING: linbofs64.xz template not found, using current linbofs64"
    xzcat "$LINBOFS" | cpio -i -d -H newc --no-absolute-filenames 2>/dev/null || true
fi

# Verify extraction produced files
if [ ! -d "$WORKDIR/bin" ] && [ ! -d "$WORKDIR/etc" ]; then
    echo "ERROR: Failed to extract linbofs — no bin/ or etc/ directory found!"
    exit 1
fi
echo "Extract OK ($(find "$WORKDIR" -type f | wc -l) files)"

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
    tar xf "$VARIANT_DIR/modules.tar.xz"

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
# Step 7b: Inject host kernel modules (if USE_HOST_KERNEL=true)
# =============================================================================
# When running in Docker with the host kernel, the linbo7 package modules
# won't match. We inject the host's /lib/modules/<kver> instead, so the
# initrd boots with full hardware support on the host kernel.

if [ "$USE_HOST_KERNEL" = "true" ]; then
    HOST_KVER=$(uname -r)
    HOST_MOD_SRC="${HOST_MODULES_PATH_OVERRIDE:-/lib/modules/$HOST_KVER}"

    if [ -d "$HOST_MOD_SRC" ]; then
        echo "Injecting HOST kernel modules ($HOST_KVER)..."

        # Clean previous modules
        mkdir -p lib/modules
        rm -rf lib/modules/*

        # Copy host modules: use rsync to follow symlinks but skip broken ones
        # build/ and source/ are symlinks to /usr/src/* which don't exist in container
        if command -v rsync &>/dev/null; then
            rsync -a --copy-links --safe-links \
                --exclude='build' --exclude='source' \
                "$HOST_MOD_SRC/" "lib/modules/$HOST_KVER/"
        else
            # Fallback: copy without following symlinks, then clean up
            cp -r "$HOST_MOD_SRC" "lib/modules/$HOST_KVER"
            rm -rf "lib/modules/$HOST_KVER/build" "lib/modules/$HOST_KVER/source"
        fi

        # Run depmod for host kernel version
        if command -v depmod &>/dev/null; then
            depmod -a -b . "$HOST_KVER"
            echo "  - depmod completed for $HOST_KVER"
        fi

        MOD_COUNT=$(find "lib/modules/$HOST_KVER" -name '*.ko' -o -name '*.ko.xz' -o -name '*.ko.zst' | wc -l)
        echo "  - Host modules injected: $MOD_COUNT files"

        # Disable package variant module injection (host modules take priority)
        HAS_KERNEL_VARIANT=false
    else
        echo "WARNING: Host modules not found at $HOST_MOD_SRC"
        echo "Falling back to package kernel modules (if available)"
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
# Step 10.4: Patch init.sh for standalone Docker operation
# =============================================================================
#
# Problem: init.sh unconditionally overwrites LINBOSERVER with SERVERID (from
# DHCP) when HOSTGROUP is set. In standard linuxmuster, DHCP server = LINBO
# server, so this is fine. In Docker standalone (separate server), the DHCP
# response comes from the production server, overwriting our cmdline server=.
#
# Fix: If server= was explicitly passed on the kernel cmdline, skip the
# LINBOSERVER override so the cmdline value is preserved.
#

if [ -f "$WORKDIR/init.sh" ]; then
    echo "Patching init.sh for standalone operation..."

    # Guard the LINBOSERVER="${SERVERID}" override with a cmdline check.
    # Original: unconditionally overwrites LINBOSERVER when HOSTGROUP is set.
    # Patched: only overwrite if server= was NOT on the kernel cmdline.
    #
    # For every line containing both LINBOSERVER and SERVERID (the override),
    # prepend `grep -q "server=" /proc/cmdline ||` to skip it when server= is on cmdline.
    # This is safe because:
    # - In standard linuxmuster (no server= on cmdline): override still happens (unchanged behavior)
    # - In Docker standalone (server= on cmdline): override is skipped (LINBOSERVER preserved)
    sed -i '/LINBOSERVER.*SERVERID/{/grep -q/!s#^\([[:space:]]*\)#\1grep -q "server=" /proc/cmdline || #}' \
        "$WORKDIR/init.sh"

    if grep -q 'grep -q "server=" /proc/cmdline' "$WORKDIR/init.sh"; then
        echo "  - init.sh patched: LINBOSERVER override guarded by cmdline check"
    else
        echo "  WARNING: init.sh patch did not apply (format may have changed)"
        echo "  Continuing without patch — DHCP-based setups still work"
    fi
fi

# =============================================================================
# Step 10.5: Inject firmware files
# =============================================================================

FIRMWARE_CONFIG="$CONFIG_DIR/firmware"
FW_BASE="/lib/firmware"

if [ -f "$FIRMWARE_CONFIG" ] && grep -qvE '^[[:space:]]*(#|$)' "$FIRMWARE_CONFIG" 2>/dev/null; then
    echo "Injecting firmware files..."

    # Clean slate — remove any old firmware from previous builds
    rm -rf lib/firmware
    mkdir -p lib/firmware

    FIRMWARE_COUNT=0
    FILES_COPIED=0

    while IFS= read -r entry || [ -n "$entry" ]; do
        # Trim whitespace + strip CR (Windows CRLF compat)
        entry="$(echo "$entry" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/\r$//')"
        [ -z "$entry" ] && continue
        [ "${entry#\#}" != "$entry" ] && continue

        # Strip /lib/firmware/ prefix (production compat)
        entry="${entry#/lib/firmware/}"

        # Segment-based traversal check (foo..bar.bin stays allowed)
        if echo "$entry" | grep -qE '(^|/)\.\.(/|$)'; then
            echo "  REJECT (path traversal): $entry"; continue
        fi
        case "$entry" in
            /*|*\\*) echo "  REJECT (unsafe path): $entry"; continue ;;
        esac

        SOURCE="$FW_BASE/$entry"
        TARGET="lib/firmware/$entry"

        # Symlink-out-of-base check on entry root
        if [ -e "$SOURCE" ]; then
            REAL_SOURCE="$(realpath "$SOURCE" 2>/dev/null)" || REAL_SOURCE=""
            if [ -n "$REAL_SOURCE" ]; then
                case "$REAL_SOURCE" in
                    "$FW_BASE"/*|"$FW_BASE") ;;
                    *) echo "  REJECT (symlink outside base): $entry -> $REAL_SOURCE"; continue ;;
                esac
            fi
        fi

        # Handle .zst — decompress (lazy zstd check: only fail when actually needed)
        if [ ! -e "$SOURCE" ] && [ -e "${SOURCE}.zst" ]; then
            REAL_ZST="$(realpath "${SOURCE}.zst" 2>/dev/null)" || REAL_ZST=""
            case "$REAL_ZST" in "$FW_BASE"/*|"$FW_BASE") ;; *)
                echo "  REJECT (zst symlink outside base): $entry"; continue ;; esac
            if ! command -v zstd >/dev/null 2>&1; then
                echo "  ERROR: zstd not found but needed for: $entry"
                exit 1
            fi
            mkdir -p "$(dirname "$TARGET")"
            if ! zstd -d -q "${SOURCE}.zst" -o "$TARGET" 2>/dev/null; then
                echo "  ERROR: zstd decompress failed: $entry"
                exit 1
            fi
            echo "  + file (decompressed): $entry"
            FIRMWARE_COUNT=$((FIRMWARE_COUNT + 1))
            FILES_COPIED=$((FILES_COPIED + 1))
            continue
        fi

        if [ ! -e "$SOURCE" ]; then
            echo "  WARN: not found: $entry"; continue
        fi

        # Copy
        if [ -d "$SOURCE" ]; then
            mkdir -p "$TARGET"
            # rsync --safe-links drops symlinks pointing outside source tree
            rsync -a --links --safe-links "$SOURCE"/ "$TARGET"/
            DIR_FILES=$(find "$TARGET" -type f | wc -l)
            echo "  + dir: $entry ($DIR_FILES files)"
            FIRMWARE_COUNT=$((FIRMWARE_COUNT + 1))
            FILES_COPIED=$((FILES_COPIED + DIR_FILES))
        else
            mkdir -p "$(dirname "$TARGET")"
            # Single file: cp -aL is safe (realpath already checked above)
            cp -aL "$SOURCE" "$TARGET"
            echo "  + file: $entry"
            FIRMWARE_COUNT=$((FIRMWARE_COUNT + 1))
            FILES_COPIED=$((FILES_COPIED + 1))
        fi
    done < "$FIRMWARE_CONFIG"

    echo "Firmware: $FIRMWARE_COUNT entries, $FILES_COPIED files injected"
else
    echo "No firmware config or empty ($FIRMWARE_CONFIG), skipping firmware injection"
fi

# =============================================================================
# Step 10.6: Inject wpa_supplicant config
# =============================================================================

WPA_CONF="$CONFIG_DIR/wpa_supplicant.conf"
if [ -f "$WPA_CONF" ] && [ -s "$WPA_CONF" ]; then
    echo "Injecting wpa_supplicant.conf..."
    mkdir -p etc
    cp "$WPA_CONF" etc/wpa_supplicant.conf
    chmod 600 etc/wpa_supplicant.conf
    echo "  - WLAN config injected"
fi

# =============================================================================
# Step 10.7: Inject GUI themes and custom linbo_gui binary
# =============================================================================

# 10.7a: GUI themes — copy from provisioned themes into linbofs
GUI_THEMES_SRC="$LINBO_DIR/gui-themes"
if [ -d "$GUI_THEMES_SRC" ] && [ "$(ls -A "$GUI_THEMES_SRC" 2>/dev/null)" ]; then
    echo "Injecting GUI themes..."
    THEME_COUNT=0
    for theme_dir in "$GUI_THEMES_SRC"/*/; do
        [ -d "$theme_dir" ] || continue
        theme_name=$(basename "$theme_dir")
        # Validate theme name (alphanumeric + hyphens only)
        case "$theme_name" in
            *[!a-zA-Z0-9_-]*) echo "  REJECT (invalid name): $theme_name"; continue ;;
        esac
        mkdir -p "themes/$theme_name"
        cp -r "$theme_dir"* "themes/$theme_name/"
        echo "  + theme: $theme_name"
        THEME_COUNT=$((THEME_COUNT + 1))
    done
    echo "GUI themes: $THEME_COUNT injected"
else
    echo "No GUI themes found ($GUI_THEMES_SRC), skipping"
fi

# 10.7b: Custom linbo_gui binary — override the default binary in linbofs
CUSTOM_GUI="$CONFIG_DIR/linbo_gui"
if [ -f "$CUSTOM_GUI" ]; then
    echo "Injecting custom linbo_gui binary..."
    if [ ! -x "$CUSTOM_GUI" ]; then
        echo "  WARNING: $CUSTOM_GUI is not executable, setting +x"
    fi
    cp "$CUSTOM_GUI" "usr/bin/linbo_gui"
    chmod 755 "usr/bin/linbo_gui"
    echo "  - Custom linbo_gui injected ($(stat -c%s "$CUSTOM_GUI") bytes)"
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

# Sanity check: new file must be at least 10MB (reasonable minimum for linbofs64)
MIN_SIZE=10485760
if [ "$NEW_SIZE" -lt "$MIN_SIZE" ]; then
    echo "ERROR: New file is suspiciously small ($NEW_SIZE bytes, minimum $MIN_SIZE)"
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

if [ "$SKIP_KERNEL_COPY" = "true" ]; then
    echo "Skipping kernel copy (SKIP_KERNEL_COPY=true, host kernel preserved)"
elif [ "$HAS_KERNEL_VARIANT" = "true" ]; then
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
