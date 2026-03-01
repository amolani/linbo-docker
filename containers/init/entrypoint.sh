#!/bin/sh
set -e

# Configuration
BOOT_FILES_URL="${BOOT_FILES_URL:-https://github.com/amolani/linbo-docker/releases/latest/download/linbo-boot-files.tar.gz}"
LINBO_DIR="/srv/linbo"
KERNEL_DIR="/var/lib/linuxmuster/linbo"
MARKER_FILE="${LINBO_DIR}/.boot-files-installed"
FORCE_UPDATE="${FORCE_UPDATE:-false}"

# =============================================================================
# Kernel Variant Provisioning (Atomic Symlink-Swap)
# =============================================================================

provision_kernels() {
    KERNEL_SRC="${LINBO_DIR}/kernels"
    MANIFEST_FILE="${KERNEL_SRC}/manifest.json"
    PROVISION_MARKER="${KERNEL_DIR}/.provisioned-version"
    PROVISION_LOCK="${KERNEL_DIR}/.provision.lock"
    SETS_DIR="${KERNEL_DIR}/sets"

    # Check if kernel variants exist in boot files
    if [ ! -f "${MANIFEST_FILE}" ]; then
        echo "No kernel manifest found, skipping kernel provisioning"
        echo "(This is normal for older boot file releases)"
        return 0
    fi

    echo ""
    echo "=== Kernel Variant Provisioning ==="

    # Calculate manifest hash for versioning
    MANIFEST_HASH=$(sha256sum "${MANIFEST_FILE}" | cut -c1-8)
    echo "Manifest hash: ${MANIFEST_HASH}"

    # Check if already provisioned with same manifest
    if [ -f "${PROVISION_MARKER}" ]; then
        EXISTING_HASH=$(grep -o '"manifestHash":"[^"]*"' "${PROVISION_MARKER}" | cut -d'"' -f4 2>/dev/null || echo "")
        if [ "${EXISTING_HASH}" = "${MANIFEST_HASH}" ] && [ "${FORCE_UPDATE}" != "true" ]; then
            echo "Kernel variants already provisioned (hash: ${MANIFEST_HASH})"
            return 0
        fi
    fi

    # Cleanup stale temp dirs from previous crashed runs
    if [ -d "${SETS_DIR}" ]; then
        for tmpdir in "${SETS_DIR}"/.tmp-*; do
            if [ -d "$tmpdir" ]; then
                rm -rf "$tmpdir"
                echo "Cleaned up stale temp: $tmpdir"
            fi
        done
    fi

    # Acquire lock (non-blocking, fail if locked)
    mkdir -p "${KERNEL_DIR}"
    exec 9>"${PROVISION_LOCK}"
    if ! flock -n 9; then
        echo "WARNING: Another provisioning process is running, skipping"
        return 0
    fi

    echo "Provisioning kernel variants..."
    NEW_SET_DIR="${SETS_DIR}/${MANIFEST_HASH}"
    TEMP_SET_DIR="${SETS_DIR}/.tmp-${MANIFEST_HASH}"

    # Extract into temp directory (same filesystem for atomic rename)
    mkdir -p "${TEMP_SET_DIR}"

    for variant in stable longterm legacy; do
        SRC_DIR="${KERNEL_SRC}/${variant}"
        DST_DIR="${TEMP_SET_DIR}/${variant}"

        if [ -d "${SRC_DIR}" ]; then
            mkdir -p "${DST_DIR}"
            for f in linbo64 modules.tar.xz version; do
                if [ -f "${SRC_DIR}/${f}" ]; then
                    cp "${SRC_DIR}/${f}" "${DST_DIR}/${f}"
                fi
            done
            KVER=$(cat "${DST_DIR}/version" 2>/dev/null || echo "unknown")
            echo "  - ${variant}: ${KVER}"
        fi
    done

    # Copy linbofs64.xz template
    if [ -f "${LINBO_DIR}/linbofs64.xz" ]; then
        cp "${LINBO_DIR}/linbofs64.xz" "${TEMP_SET_DIR}/linbofs64.xz"
        echo "  - linbofs64.xz template copied"
    fi

    # Copy manifest
    cp "${MANIFEST_FILE}" "${TEMP_SET_DIR}/manifest.json"

    # Verify against manifest (sha256)
    echo "Verifying checksums..."
    VERIFY_OK=true
    for variant in stable longterm legacy; do
        for f in linbo64 modules.tar.xz version; do
            FPATH="${TEMP_SET_DIR}/${variant}/${f}"
            if [ -f "${FPATH}" ]; then
                EXPECTED=""
                if command -v python3 >/dev/null 2>&1; then
                    EXPECTED=$(python3 -c "
import json,sys
m=json.load(open('${MANIFEST_FILE}'))
v=m.get('variants',{}).get('${variant}',{})
fi=v.get('${f}',{})
print(fi.get('sha256',''))
" 2>/dev/null || echo "")
                fi
                if [ -n "${EXPECTED}" ]; then
                    ACTUAL=$(sha256sum "${FPATH}" | cut -d' ' -f1)
                    if [ "${ACTUAL}" != "${EXPECTED}" ]; then
                        echo "ERROR: Checksum mismatch for ${variant}/${f}"
                        echo "  Expected: ${EXPECTED}"
                        echo "  Actual:   ${ACTUAL}"
                        VERIFY_OK=false
                    fi
                fi
            fi
        done
    done

    # Verify linbofs64.xz template
    if [ -f "${TEMP_SET_DIR}/linbofs64.xz" ] && command -v python3 >/dev/null 2>&1; then
        EXPECTED=$(python3 -c "
import json,sys
m=json.load(open('${MANIFEST_FILE}'))
t=m.get('template',{})
print(t.get('sha256',''))
" 2>/dev/null || echo "")
        if [ -n "${EXPECTED}" ]; then
            ACTUAL=$(sha256sum "${TEMP_SET_DIR}/linbofs64.xz" | cut -d' ' -f1)
            if [ "${ACTUAL}" != "${EXPECTED}" ]; then
                echo "ERROR: Checksum mismatch for linbofs64.xz template"
                VERIFY_OK=false
            fi
        fi
    fi

    if [ "${VERIFY_OK}" != "true" ]; then
        echo "ERROR: Verification failed, aborting provisioning"
        rm -rf "${TEMP_SET_DIR}"
        flock -u 9
        return 1
    fi
    echo "  Checksums OK"

    # Atomic rename: temp -> final set directory
    # Remove target if it already exists (from a previous run)
    if [ -d "${NEW_SET_DIR}" ]; then
        rm -rf "${NEW_SET_DIR}"
    fi
    mv "${TEMP_SET_DIR}" "${NEW_SET_DIR}"

    # Atomic symlink swap
    # If current is a real directory (not a symlink), remove it first
    if [ -d "${KERNEL_DIR}/current" ] && [ ! -L "${KERNEL_DIR}/current" ]; then
        rm -rf "${KERNEL_DIR}/current"
    fi
    ln -sfn "sets/${MANIFEST_HASH}" "${KERNEL_DIR}/current.new"
    mv -f "${KERNEL_DIR}/current.new" "${KERNEL_DIR}/current" 2>/dev/null \
        || { rm -f "${KERNEL_DIR}/current" 2>/dev/null; mv "${KERNEL_DIR}/current.new" "${KERNEL_DIR}/current"; }

    # Write provisioned marker (crash-safe: write temp + rename)
    MARKER_TMP="${PROVISION_MARKER}.tmp"
    printf '{"version":"%s","manifestHash":"%s","timestamp":"%s"}\n' \
        "${VERSION:-unknown}" "${MANIFEST_HASH}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        > "${MARKER_TMP}"
    mv "${MARKER_TMP}" "${PROVISION_MARKER}"

    # Cleanup old sets (keep only current)
    CURRENT_TARGET=$(readlink "${KERNEL_DIR}/current" 2>/dev/null | sed 's|^sets/||')
    if [ -d "${SETS_DIR}" ] && [ -n "${CURRENT_TARGET}" ]; then
        for old_set in "${SETS_DIR}"/*/; do
            OLD_NAME=$(basename "$old_set")
            if [ "${OLD_NAME}" != "${CURRENT_TARGET}" ]; then
                rm -rf "$old_set"
                echo "  Cleaned up old set: ${OLD_NAME}"
            fi
        done
    fi

    # Set permissions
    chown -R 1001:1001 "${KERNEL_DIR}"

    # Release lock
    flock -u 9

    echo "=== Kernel variants provisioned successfully ==="
    echo "Active set: ${MANIFEST_HASH}"
    ls -la "${KERNEL_DIR}/current/" 2>/dev/null || true
}

# =============================================================================
# GUI Theme Provisioning
# =============================================================================

provision_themes() {
    THEMES_SRC="/opt/linbo-themes"
    THEMES_DST="${LINBO_DIR}/gui-themes"

    if [ -d "${THEMES_SRC}" ] && [ "$(ls -A "${THEMES_SRC}" 2>/dev/null)" ]; then
        echo ""
        echo "=== GUI Theme Provisioning ==="
        mkdir -p "${THEMES_DST}"
        for theme_dir in "${THEMES_SRC}"/*/; do
            [ -d "$theme_dir" ] || continue
            theme_name=$(basename "$theme_dir")
            mkdir -p "${THEMES_DST}/${theme_name}"
            cp -r "${theme_dir}"* "${THEMES_DST}/${theme_name}/"
            echo "  - Theme: ${theme_name}"
        done
        chown -R 1001:1001 "${THEMES_DST}"
        echo "GUI themes provisioned to ${THEMES_DST}"
    fi
}

# =============================================================================
# Main: Boot Files Download
# =============================================================================

echo "=== LINBO Boot Files Init ==="
echo "Target directory: ${LINBO_DIR}"
echo "Kernel directory: ${KERNEL_DIR}"
echo "Download URL: ${BOOT_FILES_URL}"

# =============================================================================
# Host Kernel Auto-Restore
# =============================================================================
# The Docker host kernel is needed for hardware compatibility.
# If linbo64 was replaced by a small linbo7 package kernel (e.g. after update),
# clients lose network after GRUB handoff. This function auto-restores.

restore_host_kernel() {
    HOST_KVER=$(uname -r)
    HOST_KERNEL="/boot/vmlinuz-${HOST_KVER}"
    LINBO64="${LINBO_DIR}/linbo64"
    KVER_MARKER="${LINBO_DIR}/.host-kernel-version"

    if [ ! -f "${HOST_KERNEL}" ]; then
        echo "INFO: Host kernel not available at ${HOST_KERNEL}"
        echo "(This is normal if /boot is not bind-mounted)"
        return 0
    fi

    NEED_RESTORE=false

    # Check 1: No marker file — first run or marker was lost, always restore
    if [ ! -f "${KVER_MARKER}" ]; then
        echo "INFO: No host kernel marker found, will provision host kernel"
        NEED_RESTORE=true
    fi

    # Check 2: Kernel drift — host kernel version changed since last provision
    if [ -f "${KVER_MARKER}" ]; then
        STORED_KVER=$(cat "${KVER_MARKER}")
        if [ "${STORED_KVER}" != "${HOST_KVER}" ]; then
            echo "WARNING: Host kernel changed (${STORED_KVER} -> ${HOST_KVER})"
            NEED_RESTORE=true
        fi
    fi

    # Check 3: Size comparison — if linbo64 is <8MB, it's likely the package kernel
    if [ -f "${LINBO64}" ]; then
        LINBO64_SIZE=$(stat -c%s "${LINBO64}" 2>/dev/null || echo 0)
        HOST_SIZE=$(stat -c%s "${HOST_KERNEL}" 2>/dev/null || echo 0)

        if [ "${LINBO64_SIZE}" -lt 8000000 ] && [ "${HOST_SIZE}" -gt 8000000 ]; then
            echo "WARNING: linbo64 is suspiciously small (${LINBO64_SIZE} bytes vs host kernel ${HOST_SIZE} bytes)"
            NEED_RESTORE=true
        fi
    else
        # linbo64 doesn't exist yet — will be created by extraction
        NEED_RESTORE=true
    fi

    # Check 4: Version mismatch — linbo64 kernel version differs from host
    if [ "${NEED_RESTORE}" = "false" ] && [ -f "${LINBO64}" ]; then
        LINBO64_KVER=$(file "${LINBO64}" 2>/dev/null | grep -o 'version [0-9][^ ]*' | awk '{print $2}')
        if [ -n "${LINBO64_KVER}" ] && [ "${LINBO64_KVER}" != "${HOST_KVER}" ]; then
            echo "WARNING: linbo64 kernel version mismatch (${LINBO64_KVER} != host ${HOST_KVER})"
            NEED_RESTORE=true
        fi
    fi

    if [ "${NEED_RESTORE}" = "true" ]; then
        echo "Restoring host kernel as linbo64..."
        cp "${HOST_KERNEL}" "${LINBO64}"
        md5sum "${LINBO64}" | awk '{print $1}' > "${LINBO64}.md5"
        echo "${HOST_KVER}" > "${KVER_MARKER}"
        chown 1001:1001 "${LINBO64}" "${LINBO64}.md5" "${KVER_MARKER}"
        echo "  Host kernel ${HOST_KVER} restored ($(stat -c%s "${LINBO64}") bytes)"
    fi
}

# Check if boot files already exist
if [ -f "${MARKER_FILE}" ] && [ "${FORCE_UPDATE}" != "true" ]; then
    INSTALLED_VERSION=$(cat "${MARKER_FILE}")
    echo "Boot files already installed (version: ${INSTALLED_VERSION})"
    echo "Set FORCE_UPDATE=true to force re-download"
    restore_host_kernel
    provision_kernels
    provision_themes
    exit 0
fi

# Check if linbo64 exists (fallback check)
if [ -f "${LINBO_DIR}/linbo64" ] && [ "${FORCE_UPDATE}" != "true" ]; then
    echo "Boot files found (linbo64 exists), skipping download"
    echo "Set FORCE_UPDATE=true to force re-download"
    restore_host_kernel
    provision_kernels
    provision_themes
    exit 0
fi

echo "Downloading boot files..."

# Create temp directory
TEMP_DIR=$(mktemp -d)
cd "${TEMP_DIR}"

# Download with retry
MAX_RETRIES=3
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -fSL --progress-bar -o boot-files.tar.gz "${BOOT_FILES_URL}"; then
        echo "Download successful"
        break
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo "Download failed (attempt ${RETRY_COUNT}/${MAX_RETRIES})"
        if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
            echo "Retrying in 5 seconds..."
            sleep 5
        fi
    fi
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "ERROR: Failed to download boot files after ${MAX_RETRIES} attempts"
    echo "Please check your internet connection and the URL"
    exit 1
fi

# Extract
echo "Extracting boot files..."
mkdir -p "${LINBO_DIR}"
tar -xzf boot-files.tar.gz -C "${LINBO_DIR}"

# Verify essential files
echo "Verifying installation..."
if [ ! -f "${LINBO_DIR}/linbo64" ]; then
    echo "ERROR: Missing essential file: linbo64"
    exit 1
fi
if [ ! -f "${LINBO_DIR}/linbofs64" ]; then
    echo "WARNING: linbofs64 not found — will be built by update-linbofs.sh on first API start"
fi

# Replace extracted package kernel with host kernel (if available)
restore_host_kernel

# Write marker file with version info
VERSION=$(date +%Y%m%d-%H%M%S)
if [ -f "${LINBO_DIR}/VERSION" ]; then
    VERSION=$(cat "${LINBO_DIR}/VERSION")
fi
echo "${VERSION}" > "${MARKER_FILE}"

# Set permissions - linbo user (uid 1001) needs write access
chmod -R 755 "${LINBO_DIR}"
chown -R 1001:1001 "${LINBO_DIR}"

# Cleanup download temp
rm -rf "${TEMP_DIR}"

echo "=== Boot files installed successfully ==="
echo "Version: ${VERSION}"
echo "Files:"
ls -la "${LINBO_DIR}/" | head -15

# Provision kernel variants
provision_kernels

# Fix permissions on driver volume (created as root by Docker)
DRIVER_DIR="/var/lib/linbo/drivers"
if [ -d "${DRIVER_DIR}" ]; then
    chown 1001:1001 "${DRIVER_DIR}"
    echo "Driver volume permissions set (1001:1001)"
fi

# Provision GUI themes
provision_themes

# Create gui/ symlinks (new LINBO versions look for gui/linbo_gui64_7.tar.lz and gui/icons/)
if [ -f "${LINBO_DIR}/linbo_gui64_7.tar.lz" ]; then
    mkdir -p "${LINBO_DIR}/gui"
    ln -sf "${LINBO_DIR}/linbo_gui64_7.tar.lz" "${LINBO_DIR}/gui/linbo_gui64_7.tar.lz"
    ln -sf "${LINBO_DIR}/linbo_gui64_7.tar.lz.md5" "${LINBO_DIR}/gui/linbo_gui64_7.tar.lz.md5" 2>/dev/null
    # Icons symlink (gui/icons/ → icons/)
    if [ -d "${LINBO_DIR}/icons" ]; then
        ln -sfn "${LINBO_DIR}/icons" "${LINBO_DIR}/gui/icons"
    fi
    chown -h 1001:1001 "${LINBO_DIR}/gui"/* 2>/dev/null
    echo "GUI symlinks created in ${LINBO_DIR}/gui/"
fi

exit 0
