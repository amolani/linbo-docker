#!/bin/sh
set -e

# Configuration
BOOT_FILES_URL="${BOOT_FILES_URL:-https://github.com/amolani/linbo-docker/releases/latest/download/linbo-boot-files.tar.gz}"
LINBO_DIR="/srv/linbo"
MARKER_FILE="${LINBO_DIR}/.boot-files-installed"
FORCE_UPDATE="${FORCE_UPDATE:-false}"

echo "=== LINBO Boot Files Init ==="
echo "Target directory: ${LINBO_DIR}"
echo "Download URL: ${BOOT_FILES_URL}"

# Check if boot files already exist
if [ -f "${MARKER_FILE}" ] && [ "${FORCE_UPDATE}" != "true" ]; then
    INSTALLED_VERSION=$(cat "${MARKER_FILE}")
    echo "Boot files already installed (version: ${INSTALLED_VERSION})"
    echo "Set FORCE_UPDATE=true to force re-download"
    exit 0
fi

# Check if linbo64 exists (fallback check)
if [ -f "${LINBO_DIR}/linbo64" ] && [ "${FORCE_UPDATE}" != "true" ]; then
    echo "Boot files found (linbo64 exists), skipping download"
    echo "Set FORCE_UPDATE=true to force re-download"
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

# Set permissions
chmod -R 755 "${LINBO_DIR}"

# Cleanup
rm -rf "${TEMP_DIR}"

echo "=== Boot files installed successfully ==="
echo "Version: ${VERSION}"
echo "Files:"
ls -la "${LINBO_DIR}/" | head -15

exit 0
