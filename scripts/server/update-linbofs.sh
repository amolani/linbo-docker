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

# Fallback network settings (used in Docker patches for DHCP failure fallback)
FALLBACK_IP="${LINBO_FALLBACK_IP:-10.0.150.254}"
FALLBACK_GW="${LINBO_GATEWAY:-10.0.0.254}"
FALLBACK_MASK="${LINBO_FALLBACK_MASK:-16}"

# =============================================================================
# Patch Framework
# =============================================================================
PATCH_RESULTS=()

record_patch() {
    local name="$1" level="$2" status="$3"
    PATCH_RESULTS+=("${name}|${level}|${status}")
    if [[ "$status" == "FAILED" && "$level" == "CRITICAL" ]]; then
        echo "  FATAL: Critical patch '$name' failed to apply!"
    fi
}

# try_patch NAME LEVEL FILE MARKER CMD1 [CMD2] [CMD3]
# Tries each CMD until MARKER appears in FILE, records result.
try_patch() {
    local name="$1" level="$2" file="$3" marker="$4"
    shift 4

    # Already applied?
    if grep -q "$marker" "$file" 2>/dev/null; then
        echo "  - $name already present"
        record_patch "$name" "$level" "OK"
        return 0
    fi

    # Try each command in order
    local cmd
    for cmd in "$@"; do
        eval "$cmd"
        if grep -q "$marker" "$file" 2>/dev/null; then
            echo "  - $name applied successfully"
            record_patch "$name" "$level" "OK"
            return 0
        fi
    done

    record_patch "$name" "$level" "FAILED"
    return 1
}

# =============================================================================
# Auto-detect Docker host kernel
# =============================================================================
# When /boot/vmlinuz-<kver> and /lib/modules/<kver> are bind-mounted from the
# Docker host, automatically use them. This makes the script safe to call
# directly (docker exec) without requiring USE_HOST_KERNEL to be passed.
if [ "$USE_HOST_KERNEL" = "false" ]; then
    _auto_kver=$(uname -r)
    if [ -f "/boot/vmlinuz-${_auto_kver}" ] && [ -d "/lib/modules/${_auto_kver}" ]; then
        echo "AUTO-DETECT: Host kernel ${_auto_kver} found, enabling host kernel mode"
        USE_HOST_KERNEL=true
        SKIP_KERNEL_COPY=true
    fi
fi

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

if [ "$HAS_KERNEL_VARIANT" = "true" ] && [ "$USE_HOST_KERNEL" != "true" ]; then
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
elif [ "$HAS_KERNEL_VARIANT" = "true" ] && [ "$USE_HOST_KERNEL" = "true" ]; then
    echo "Skipping variant module extraction (host kernel takes priority)"
fi

# =============================================================================
# Step 7b: Inject host kernel modules (if USE_HOST_KERNEL=true)
# =============================================================================
# When running in Docker with the host kernel, the linbo7 package modules
# won't match. We inject the host's /lib/modules/<kver> instead, so the
# initrd boots with full hardware support on the host kernel.

if [ "$USE_HOST_KERNEL" = "true" ]; then
    if [ -n "$HOST_MODULES_PATH_OVERRIDE" ]; then
        # Extract kernel version from the explicit module path
        HOST_KVER=$(basename "$HOST_MODULES_PATH_OVERRIDE")
        HOST_MOD_SRC="$HOST_MODULES_PATH_OVERRIDE"
    else
        HOST_KVER=$(uname -r)
        HOST_MOD_SRC="/lib/modules/$HOST_KVER"
    fi

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
    DROPBEAR_KEYS=$(ls etc/dropbear/*_host_key 2>/dev/null | wc -l)
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
# Step 10.4: Docker patch helper functions
# =============================================================================
# These functions define multi-line patch insertions used by try_patch() below.
# Defining them as functions avoids escaping issues with eval'd strings.

_apply_iface_wait_primary() {
    sed -i '/for dev in.*proc\/net\/dev/i\
  # --- DOCKER_IFACE_WAIT: wait for NICs after udev + force UP ---\
  local _iface_wait=0\
  while [ $_iface_wait -lt 10 ]; do\
    _found_if=$(ls /sys/class/net/ 2>/dev/null | grep -v ^lo | head -1)\
    [ -n "$_found_if" ] && break\
    _iface_wait=$((_iface_wait + 1))\
    sleep 1\
  done\
  [ -n "$_found_if" ] && echo "Network interface $_found_if found after ${_iface_wait}s"\
  # Force bring UP all non-lo interfaces immediately\
  for _fif in $(ls /sys/class/net/ 2>/dev/null | grep -v ^lo); do\
    ip link set dev "$_fif" up 2>/dev/null\
  done\
  sleep 2' "$WORKDIR/init.sh"
}

_apply_iface_wait_fallback() {
    sed -i '/for[[:space:]].*in.*sys\/class\/net/i\
  # --- DOCKER_IFACE_WAIT: wait for NICs after udev + force UP ---\
  local _iface_wait=0\
  while [ $_iface_wait -lt 10 ]; do\
    _found_if=$(ls /sys/class/net/ 2>/dev/null | grep -v ^lo | head -1)\
    [ -n "$_found_if" ] && break\
    _iface_wait=$((_iface_wait + 1))\
    sleep 1\
  done\
  [ -n "$_found_if" ] && echo "Network interface $_found_if found after ${_iface_wait}s"\
  # Force bring UP all non-lo interfaces immediately\
  for _fif in $(ls /sys/class/net/ 2>/dev/null | grep -v ^lo); do\
    ip link set dev "$_fif" up 2>/dev/null\
  done\
  sleep 2' "$WORKDIR/init.sh"
}

_apply_storage_modules_primary() {
    sed -i '1,/^#!/{/^#!/a\
# --- DOCKER_STORAGE_MODULES: load disk drivers early ---\
for _mod in ahci sd_mod sr_mod nvme ata_piix ata_generic virtio_blk virtio_scsi evdev hid hid_generic usbhid virtio_input psmouse xhci_hcd ehci_hcd uhci_hcd; do\
    modprobe "$_mod" 2>/dev/null\
done
}' "$WORKDIR/init.sh"
}

_apply_storage_modules_fallback() {
    sed -i '/^set -e/a\
# --- DOCKER_STORAGE_MODULES: load disk drivers early ---\
for _mod in ahci sd_mod sr_mod nvme ata_piix ata_generic virtio_blk virtio_scsi evdev hid hid_generic usbhid virtio_input psmouse xhci_hcd ehci_hcd uhci_hcd; do\
    modprobe "$_mod" 2>/dev/null\
done' "$WORKDIR/init.sh"
}

_apply_dhcp_fallback_primary() {
    sed -i '/^[[:space:]]*# create environment/i\  # Fix RC when no interface was found (loop never executed)\n  [ -z "$ipaddr" ] && RC=1\n  # --- DOCKER_DHCP_FALLBACK ---\n  /docker_net_fallback.sh "$RC"\n  [ $? -eq 0 ] && RC=0' \
        "$WORKDIR/init.sh"
}

_apply_dhcp_fallback_fallback() {
    sed -i '/do_env/i\  # Fix RC when no interface was found (loop never executed)\n  [ -z "$ipaddr" ] && RC=1\n  # --- DOCKER_DHCP_FALLBACK ---\n  /docker_net_fallback.sh "$RC"\n  [ $? -eq 0 ] && RC=0' \
        "$WORKDIR/init.sh"
}

_apply_net_recovery_primary() {
    sed -i '/^# update & extract linbo_gui/i\# --- DOCKER_NET_RECOVERY ---\nsource /docker_net_recovery.sh' \
        "$WORKDIR/linbo.sh"
}

_apply_net_recovery_fallback() {
    sed -i '/linbo_update_gui/i\# --- DOCKER_NET_RECOVERY ---\nsource /docker_net_recovery.sh' \
        "$WORKDIR/linbo.sh"
}

_apply_udev_input_primary() {
    sed -i '/linbo_gui.*-platform.*linuxfb/i\
    # --- DOCKER_UDEV_INPUT: ensure udev database exists for libinput ---\
    if ! pidof udevd >/dev/null 2>&1; then\
      mkdir -p /run/udev\
      udevd --daemon 2>/dev/null\
      udevadm trigger --type=all --action=add 2>/dev/null\
      udevadm settle --timeout=5 2>/dev/null\
    fi' "$WORKDIR/linbo.sh"
}

_apply_udev_input_fb1() {
    sed -i '/linbo_gui.*-platform/i\
    # --- DOCKER_UDEV_INPUT: ensure udev database exists for libinput ---\
    if ! pidof udevd >/dev/null 2>&1; then\
      mkdir -p /run/udev\
      udevd --daemon 2>/dev/null\
      udevadm trigger --type=all --action=add 2>/dev/null\
      udevadm settle --timeout=5 2>/dev/null\
    fi' "$WORKDIR/linbo.sh"
}

_apply_udev_input_fb2() {
    sed -i '/[[:space:]]linbo_gui\b/i\
    # --- DOCKER_UDEV_INPUT: ensure udev database exists for libinput ---\
    if ! pidof udevd >/dev/null 2>&1; then\
      mkdir -p /run/udev\
      udevd --daemon 2>/dev/null\
      udevadm trigger --type=all --action=add 2>/dev/null\
      udevadm settle --timeout=5 2>/dev/null\
    fi' "$WORKDIR/linbo.sh"
}

_apply_net_diag() {
    cat > /tmp/diag_block.txt << 'DIAGEOF'
    echo " This LINBO client is in remote control mode."
    echo ""
    echo " --- DOCKER_NET_DIAG v2 ---"
    echo " BEFORE fix: $(ip link show dev eth0 2>&1 | head -1)"
    ip link set dev eth0 up 2>/dev/null
    _fixrc=$?
    sleep 1
    echo " ip link set eth0 up: exit=$_fixrc"
    echo " AFTER fix: $(ip link show dev eth0 2>&1 | head -1)"
    echo " carrier: $(cat /sys/class/net/eth0/carrier 2>/dev/null || echo none)"
    echo " operstate: $(cat /sys/class/net/eth0/operstate 2>/dev/null)"
    echo ""
    echo " IP: $(ip addr show dev eth0 2>/dev/null | grep 'inet ' || echo 'none')"
    echo " Kernel: $(uname -r)"
    echo " LINBOSERVER=$LINBOSERVER SERVERID=$SERVERID"
    echo " cmdline: $(cat /proc/cmdline)"
    echo ""
    echo " init.sh log (last 20 lines):"
    tail -20 /tmp/linbo.log 2>/dev/null || tail -20 /tmp/init.log 2>/dev/null || echo "  (no log)"
    echo " ---"
DIAGEOF
    awk '
    /echo " This LINBO client is in remote control mode."/ {
        while ((getline line < "/tmp/diag_block.txt") > 0) print line
        next
    }
    { print }
    ' "$WORKDIR/linbo.sh" > "$WORKDIR/linbo.sh.tmp" && \
        mv "$WORKDIR/linbo.sh.tmp" "$WORKDIR/linbo.sh" && \
        chmod +x "$WORKDIR/linbo.sh"
    rm -f /tmp/diag_block.txt
}

# =============================================================================
# Step 10.4b: Apply Docker patches for standalone operation
# =============================================================================
#
# All patches use try_patch() for consistent tracking and failure handling.
# CRITICAL patches abort the build if they fail. OPTIONAL patches warn only.

if [ -f "$WORKDIR/init.sh" ]; then
    echo "Applying Docker patches..."

    # -------------------------------------------------------------------------
    # Patch 1: SERVERID Guard (CRITICAL)
    # Guard the LINBOSERVER="${SERVERID}" override with a cmdline check.
    # In Docker standalone (server= on cmdline): override is skipped.
    # In standard linuxmuster (no server= on cmdline): unchanged behavior.
    # -------------------------------------------------------------------------
    try_patch "SERVERID_GUARD" "CRITICAL" "$WORKDIR/init.sh" \
        'grep -q "server=" /proc/cmdline' \
        "sed -i '/LINBOSERVER.*SERVERID/{/grep -q/!s#^\\([[:space:]]*\\)#\\1grep -q \"server=\" /proc/cmdline || #}' \"$WORKDIR/init.sh\""

    # -------------------------------------------------------------------------
    # Patch 4: Wait for network interfaces (CRITICAL)
    # udevadm settle may return before virtio_net creates eth0.
    # Wait loop + force UP before the interface iteration loop.
    # Primary: match "for dev in ... /proc/net/dev"
    # Fallback: match "for ... in ... /sys/class/net"
    # -------------------------------------------------------------------------
    try_patch "IFACE_WAIT" "CRITICAL" "$WORKDIR/init.sh" \
        "DOCKER_IFACE_WAIT" \
        "_apply_iface_wait_primary" "_apply_iface_wait_fallback"

    # -------------------------------------------------------------------------
    # Patch 6: Load storage modules early (CRITICAL)
    # Host kernel has AHCI as module (not built-in like production kernel).
    # Primary: insert after shebang
    # Fallback: insert after "set -e"
    # -------------------------------------------------------------------------
    try_patch "STORAGE_MODULES" "CRITICAL" "$WORKDIR/init.sh" \
        "DOCKER_STORAGE_MODULES" \
        "_apply_storage_modules_primary" "_apply_storage_modules_fallback"

    # -------------------------------------------------------------------------
    # Patch 2: DHCP fallback — static IP when udhcpc fails (OPTIONAL)
    # Write helper script first (embedded into linbofs), then insert call.
    # Primary: match "# create environment" comment
    # Fallback: match "do_env" function call
    # -------------------------------------------------------------------------
    cat > "$WORKDIR/docker_net_fallback.sh" << 'FALLBACK_SCRIPT'
#!/bin/sh
# DOCKER_DHCP_FALLBACK: Static IP fallback when udhcpc fails
# This runs after the udhcpc loop in network()

echo "=== Docker Network Fallback ==="
echo "udhcpc exit code: $1"
echo "Interfaces in /proc/net/dev:"
cat /proc/net/dev | grep -v "Inter\|face"
echo "Link states:"
ip link show 2>/dev/null
echo "==="

# Only activate if udhcpc failed and server= is on cmdline
[ "$1" = "0" ] && echo "DHCP succeeded, skipping fallback" && exit 0
grep -q "server=" /proc/cmdline || exit 0

# Get server IP from cmdline
FALLBACK_SERVER=$(cat /proc/cmdline | tr ' ' '\n' | grep "^server=" | cut -d= -f2)
[ -z "$FALLBACK_SERVER" ] && exit 1

# Find first non-loopback interface
for IF in $(ls /sys/class/net/ 2>/dev/null | grep -v ^lo); do
    echo "Trying interface: $IF"
    ip link set dev "$IF" up 2>/dev/null
    # Wait for link to come up
    sleep 2
    # Check link state
    CARRIER=$(cat /sys/class/net/$IF/carrier 2>/dev/null)
    OPERSTATE=$(cat /sys/class/net/$IF/operstate 2>/dev/null)
    echo "  carrier=$CARRIER operstate=$OPERSTATE"

    # Assign static IP regardless of carrier state
    ip addr add 10.0.150.254/16 dev "$IF" 2>/dev/null
    ip route add default via 10.0.0.1 2>/dev/null
    echo "ip='10.0.150.254'" > /tmp/dhcp.log
    echo "serverid='$FALLBACK_SERVER'" >> /tmp/dhcp.log
    echo "  Static IP 10.0.150.254 assigned to $IF"
    # Test connectivity
    ping -c 1 -W 2 "$FALLBACK_SERVER" >/dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "  Ping to $FALLBACK_SERVER successful!"
        exit 0
    else
        echo "  Ping to $FALLBACK_SERVER FAILED"
        # Try to bring up with ethtool
        ethtool -s "$IF" speed 1000 duplex full autoneg on 2>/dev/null
        sleep 1
        ping -c 1 -W 2 "$FALLBACK_SERVER" >/dev/null 2>&1
        if [ $? -eq 0 ]; then
            echo "  Ping to $FALLBACK_SERVER successful after ethtool!"
            exit 0
        fi
        echo "  Interface $IF not functional, trying next..."
        ip addr del 10.0.150.254/16 dev "$IF" 2>/dev/null
    fi
done

echo "WARNING: No functional network interface found!"
# Still write dhcp.log so do_env can at least parse server from cmdline
echo "ip='10.0.150.254'" > /tmp/dhcp.log
echo "serverid='$FALLBACK_SERVER'" >> /tmp/dhcp.log
exit 1
FALLBACK_SCRIPT
    chmod +x "$WORKDIR/docker_net_fallback.sh"

    # Substitute fallback IPs (heredoc is single-quoted, no expansion)
    sed -i \
        -e "s|10\.0\.150\.254/16|${FALLBACK_IP}/${FALLBACK_MASK}|g" \
        -e "s|ip='10\.0\.150\.254'|ip='${FALLBACK_IP}'|g" \
        -e "s|via 10\.0\.0\.1 |via ${FALLBACK_GW} |g" \
        "$WORKDIR/docker_net_fallback.sh"

    try_patch "DHCP_FALLBACK" "OPTIONAL" "$WORKDIR/init.sh" \
        "DOCKER_DHCP_FALLBACK" \
        "_apply_dhcp_fallback_primary" "_apply_dhcp_fallback_fallback"

    # -------------------------------------------------------------------------
    # Patches in linbo.sh (5, 7, 3)
    # -------------------------------------------------------------------------
    if [ -f "$WORKDIR/linbo.sh" ]; then

        # ---------------------------------------------------------------------
        # Patch 5: Network recovery before GUI download (OPTIONAL)
        # Bring up network if init.sh failed due to udev timing.
        # Primary: match "# update & extract linbo_gui"
        # Fallback: match "linbo_update_gui"
        # ---------------------------------------------------------------------
        cat > "$WORKDIR/docker_net_recovery.sh" << 'RECOVERY_SCRIPT'
#!/bin/sh
# DOCKER_NET_RECOVERY: Bring up network if init.sh failed
# Called from linbo.sh before linbo_update_gui
#
# This is the definitive fix for the udev timing issue where init.sh's
# network() function fails because eth0 doesn't exist yet when it runs.
# By the time linbo.sh starts, eth0 exists but is DOWN.

# Skip if network is already working
if [ -n "$LINBOSERVER" ] && [ -s /start.conf ] && grep -qi '^\[os\]' /start.conf 2>/dev/null; then
    echo "DOCKER_NET_RECOVERY: Network already OK, skipping"
    return 0
fi

echo "=== DOCKER_NET_RECOVERY ==="

# Step 1: Bring up network interfaces
NET_IF=""
for IF in $(ls /sys/class/net/ 2>/dev/null | grep -v ^lo); do
    STATE=$(cat /sys/class/net/$IF/operstate 2>/dev/null)
    if [ "$STATE" != "up" ]; then
        echo "  $IF is $STATE, bringing up..."
        ip link set dev "$IF" up
        sleep 2
    fi
    NET_IF="$IF"
    break
done

if [ -z "$NET_IF" ]; then
    echo "  ERROR: No network interface found"
    return 1
fi

# Step 2: Get IP via DHCP
CUR_IP=$(ip addr show dev "$NET_IF" 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1)
if [ -z "$CUR_IP" ]; then
    echo "  Running udhcpc on $NET_IF..."
    udhcpc -n -i "$NET_IF" -t 5
    DHCP_RC=$?
    echo "  udhcpc exit=$DHCP_RC"

    if [ $DHCP_RC -ne 0 ]; then
        # Static IP fallback
        SRV=$(cat /proc/cmdline | tr ' ' '\n' | grep '^server=' | cut -d= -f2)
        if [ -n "$SRV" ]; then
            echo "  DHCP failed, using static IP fallback"
            ip addr add 10.0.150.254/16 dev "$NET_IF" 2>/dev/null
            ip route add default via 10.0.0.1 2>/dev/null
        fi
    fi
    CUR_IP=$(ip addr show dev "$NET_IF" 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1)
fi
echo "  $NET_IF IP: $CUR_IP"

# Step 3: Parse environment from cmdline + dhcp.log (like do_env)
SRV=$(cat /proc/cmdline | tr ' ' '\n' | grep '^server=' | cut -d= -f2)
GRP=$(cat /proc/cmdline | tr ' ' '\n' | grep '^group=' | cut -d= -f2)
HGRP=$(cat /proc/cmdline | tr ' ' '\n' | grep '^hostgroup=' | cut -d= -f2)

# Get SERVERID from DHCP if available
if [ -s /tmp/dhcp.log ]; then
    DHCP_SID=$(grep '^serverid=' /tmp/dhcp.log | tail -1 | cut -d"'" -f2)
    DHCP_HOST=$(grep '^hostname=' /tmp/dhcp.log | tail -1 | cut -d"'" -f2)
    DHCP_DOMAIN=$(grep '^domain=' /tmp/dhcp.log | tail -1 | cut -d"'" -f2)
    DHCP_NIS=$(grep '^nisdomain=' /tmp/dhcp.log | tail -1 | cut -d"'" -f2)
fi

# Set LINBOSERVER: cmdline server= takes priority, fallback to DHCP serverid
[ -n "$SRV" ] && export LINBOSERVER="$SRV" || export LINBOSERVER="$DHCP_SID"
export SERVERID="${DHCP_SID:-$SRV}"

# Set HOSTGROUP: cmdline hostgroup= or group=, fallback to DHCP nisdomain
[ -n "$HGRP" ] && export HOSTGROUP="$HGRP"
[ -z "$HOSTGROUP" ] && [ -n "$GRP" ] && export HOSTGROUP="$GRP"
[ -z "$HOSTGROUP" ] && [ -n "$DHCP_NIS" ] && export HOSTGROUP="$DHCP_NIS"

# Set HOSTNAME
[ -n "$DHCP_HOST" ] && export HOSTNAME="$DHCP_HOST"
[ -z "$HOSTNAME" ] && export HOSTNAME="linbo"
echo "$HOSTNAME" > /etc/hostname
hostname "$HOSTNAME" 2>/dev/null

# Set IP and MAC
export IP="$CUR_IP"
export MACADDR=$(ip link show dev "$NET_IF" 2>/dev/null | grep 'link/ether' | awk '{print $2}')

# Write everything to /.env
{
    echo "export LINBOSERVER='$LINBOSERVER'"
    echo "export SERVERID='$SERVERID'"
    echo "export HOSTGROUP='$HOSTGROUP'"
    echo "export HOSTNAME='$HOSTNAME'"
    echo "export IP='$IP'"
    echo "export MACADDR='$MACADDR'"
} >> /.env
source /.env

echo "  LINBOSERVER=$LINBOSERVER HOSTGROUP=$HOSTGROUP"
echo "  IP=$IP MAC=$MACADDR HOST=$HOSTNAME"

# Step 4: Download start.conf from server
if [ -n "$LINBOSERVER" ] && [ -n "$HOSTGROUP" ]; then
    echo "  Downloading start.conf.$HOSTGROUP from $LINBOSERVER..."
    rsync -L "$LINBOSERVER::linbo/start.conf.$HOSTGROUP" "/start.conf" 2>&1
    if [ -s /start.conf ]; then
        echo "  start.conf downloaded OK ($(wc -c < /start.conf) bytes)"
        # Split start.conf into sections (if function available)
        type linbo_split_startconf >/dev/null 2>&1 && linbo_split_startconf
    else
        echo "  WARNING: start.conf download failed or empty"
    fi
fi

# Step 5: Mount devpts for PTY support (needed by SSH interactive shells)
if [ ! -d /dev/pts ] || ! mountpoint -q /dev/pts 2>/dev/null; then
    echo "  Mounting /dev/pts..."
    mkdir -p /dev/pts
    mount -t devpts devpts /dev/pts 2>/dev/null
fi

# Step 6: Start dropbear SSH if not running
if ! pidof dropbear >/dev/null 2>&1; then
    echo "  Starting SSH (dropbear)..."
    /sbin/dropbear -r /etc/dropbear/dropbear_dss_host_key -r /etc/dropbear/dropbear_rsa_host_key -s -g -p 2222 2>/dev/null
fi

echo "=== DOCKER_NET_RECOVERY done ==="
RECOVERY_SCRIPT
        chmod +x "$WORKDIR/docker_net_recovery.sh"

        # Substitute fallback IPs (heredoc is single-quoted, no expansion)
        sed -i \
            -e "s|10\.0\.150\.254/16|${FALLBACK_IP}/${FALLBACK_MASK}|g" \
            -e "s|via 10\.0\.0\.1 |via ${FALLBACK_GW} |g" \
            "$WORKDIR/docker_net_recovery.sh"

        try_patch "NET_RECOVERY" "OPTIONAL" "$WORKDIR/linbo.sh" \
            "DOCKER_NET_RECOVERY" \
            "_apply_net_recovery_primary" "_apply_net_recovery_fallback"

        # ---------------------------------------------------------------------
        # Patch 7: Ensure udevd runs before GUI starts (CRITICAL)
        # Without udevd, libinput can't identify input devices → buttons
        # not clickable. Restart udevd + trigger before GUI launch.
        # Primary: match "linbo_gui.*-platform.*linuxfb"
        # Fallback 1: match "linbo_gui.*-platform"
        # Fallback 2: match whitespace + "linbo_gui" word boundary
        # ---------------------------------------------------------------------
        try_patch "UDEV_INPUT" "CRITICAL" "$WORKDIR/linbo.sh" \
            "DOCKER_UDEV_INPUT" \
            "_apply_udev_input_primary" "_apply_udev_input_fb1" "_apply_udev_input_fb2"

        # ---------------------------------------------------------------------
        # Patch 3: Network diagnostics in Remote Control Mode (OPTIONAL)
        # When the GUI fails to load, show network info for debugging.
        # Uses awk replacement — no good fallback pattern.
        # ---------------------------------------------------------------------
        try_patch "NET_DIAG" "OPTIONAL" "$WORKDIR/linbo.sh" \
            "DOCKER_NET_DIAG" \
            "_apply_net_diag"
    fi
fi

# =============================================================================
# Patch Application Gate
# =============================================================================
CRITICAL_FAILED=0
OPTIONAL_FAILED=0
for _row in "${PATCH_RESULTS[@]}"; do
    [[ "$_row" == *"|CRITICAL|FAILED" ]] && ((CRITICAL_FAILED++)) || true
    [[ "$_row" == *"|OPTIONAL|FAILED" ]] && ((OPTIONAL_FAILED++)) || true
done

if (( CRITICAL_FAILED > 0 )); then
    echo ""
    echo "FATAL: $CRITICAL_FAILED critical patch(es) failed to apply!"
    echo "Patch results:"
    printf '  %s\n' "${PATCH_RESULTS[@]}"
    echo ""
    echo "Aborting build. Original linbofs64 preserved as ${LINBOFS}.bak"
    exit 1
fi

if (( OPTIONAL_FAILED > 0 )); then
    echo ""
    echo "WARNING: $OPTIONAL_FAILED optional patch(es) did not apply."
    echo "Build continues, but some features may be missing."
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
# --owner 0:0 ensures all files in the initrd are owned by root.
# The build runs as non-root (linbo, uid 1001) in Docker, but the LINBO
# client boots as root. dropbear refuses authorized_keys owned by non-root.
find . -print | cpio --quiet -o -H newc --owner 0:0 | xz -e --check=none -z -f -T 0 -c > "$LINBOFS.new"

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
# Step 12.5: Verify Docker patches in repacked archive
# =============================================================================

echo "Verifying Docker patches in archive..."
_init_txt="$(xzcat "$LINBOFS.new" | cpio -i --to-stdout init.sh 2>/dev/null || true)"
_linbo_txt="$(xzcat "$LINBOFS.new" | cpio -i --to-stdout linbo.sh 2>/dev/null || true)"
_vfail=false

# Marker checks
for _m in DOCKER_STORAGE_MODULES DOCKER_IFACE_WAIT; do
    if echo "$_init_txt" | grep -q "$_m"; then echo "  OK: $_m"
    else echo "  FAIL: $_m [CRITICAL]"; _vfail=true; fi
done
for _m in DOCKER_UDEV_INPUT; do
    if echo "$_linbo_txt" | grep -q "$_m"; then echo "  OK: $_m"
    else echo "  FAIL: $_m [CRITICAL]"; _vfail=true; fi
done

# Semantic check: SERVERID guard — no unguarded LINBOSERVER=SERVERID lines
if echo "$_init_txt" | grep -qE '^[[:space:]]*LINBOSERVER=.*SERVERID' && \
   ! echo "$_init_txt" | grep -qE 'grep -q "server=".*LINBOSERVER=.*SERVERID'; then
    echo "  FAIL: SERVERID_GUARD semantics [CRITICAL]"
    _vfail=true
else
    echo "  OK: SERVERID_GUARD"
fi

if [[ "$_vfail" == "true" ]]; then
    echo ""
    echo "FATAL: Critical patches missing or invalid in final archive!"
    echo "Build aborted. Original linbofs64 preserved."
    rm -f "$LINBOFS.new"
    exit 1
fi
echo "All critical patches verified in archive."

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
# Step 14.5: Write patch status manifest
# =============================================================================

{
    echo "# Patch Status — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '%s\n' "${PATCH_RESULTS[@]}"
} > "${LINBO_DIR}/.linbofs-patch-status"
chmod 644 "${LINBO_DIR}/.linbofs-patch-status"
echo "Patch status written to ${LINBO_DIR}/.linbofs-patch-status"

# =============================================================================
# Step 15: Copy kernel from variant (if available)
# =============================================================================

if [ "$SKIP_KERNEL_COPY" = "true" ]; then
    echo "Skipping kernel copy (SKIP_KERNEL_COPY=true, host kernel preserved)"
elif [ "$HAS_KERNEL_VARIANT" = "true" ]; then
    echo "Copying kernel from variant '$KTYPE'..."
    cp "$VARIANT_DIR/linbo64" "$LINBO_DIR/linbo64"
    chmod 644 "$LINBO_DIR/linbo64"
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
