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
    mv "${TEMP_SET_DIR}" "${NEW_SET_DIR}"

    # Atomic symlink swap
    ln -sfn "sets/${MANIFEST_HASH}" "${KERNEL_DIR}/current.new"
    mv -T "${KERNEL_DIR}/current.new" "${KERNEL_DIR}/current"

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
# Main: Boot Files Download
# =============================================================================

echo "=== LINBO Boot Files Init ==="
echo "Target directory: ${LINBO_DIR}"
echo "Kernel directory: ${KERNEL_DIR}"
echo "Download URL: ${BOOT_FILES_URL}"

# Check if boot files already exist
if [ -f "${MARKER_FILE}" ] && [ "${FORCE_UPDATE}" != "true" ]; then
    INSTALLED_VERSION=$(cat "${MARKER_FILE}")
    echo "Boot files already installed (version: ${INSTALLED_VERSION})"
    echo "Set FORCE_UPDATE=true to force re-download"
    provision_kernels
    exit 0
fi

# Check if linbo64 exists (fallback check)
if [ -f "${LINBO_DIR}/linbo64" ] && [ "${FORCE_UPDATE}" != "true" ]; then
    echo "Boot files found (linbo64 exists), skipping download"
    echo "Set FORCE_UPDATE=true to force re-download"
    provision_kernels
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
MISSING_FILES=""
for file in linbo64 linbofs64; do
    if [ ! -f "${LINBO_DIR}/${file}" ]; then
        MISSING_FILES="${MISSING_FILES} ${file}"
    fi
done

if [ -n "${MISSING_FILES}" ]; then
    echo "ERROR: Missing essential files:${MISSING_FILES}"
    exit 1
fi

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

exit 0
