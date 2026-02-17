#!/bin/sh
# Auto-deployed by LINBO Docker API
# Postsync script for patchclass-based Windows driver injection
# Based on linuxmuster.net postsync pattern (see volumes/linbo/examples/image.postsync)
#
# This script is SOURCED by linbo_sync after the OS partition is restored.

echo "##### POSTSYNC BEGIN (patchclass) #####"
LOG=/tmp/linbo-postsync.log
echo "##### POSTSYNC BEGIN (patchclass) #####" > $LOG
NOW=$(date +%Y%m%d-%H%M)
echo $NOW | tee -a $LOG

# IP-Adresse des Servers (LINBO 4.1+)
SERVERIP=$LINBOSERVER

# Patchclass name — set by LINBO Docker API at deploy time
PATCHCLASS="{{PATCHCLASS}}"
export PATCHCLASS

# Image name — for self-update at the end
IMAGENAME="{{IMAGENAME}}"

# Raum feststellen (raumname-hostname pattern, e.g. cr01-pc18)
RAUM=${HOSTNAME%%-*}
if [ "x${RAUM}" = "x" ]; then
    RAUM="unknown"
fi

# Cache directory for this patchclass (dedicated driver volume via ::drivers)
CACHE="/cache/linbo-drivers/${PATCHCLASS}"
export CACHE
mkdir -p "$CACHE"

echo "" | tee -a $LOG
echo "Hostname:      ${HOSTNAME}" | tee -a $LOG
echo "Raum:          ${RAUM}" | tee -a $LOG
echo "Patchclass:    ${PATCHCLASS}" | tee -a $LOG
echo "Cache:         ${CACHE}" | tee -a $LOG
echo "" | tee -a $LOG

# -----------------------------------------
# Phase 1: Fetch manifest + rules (few KB)
# -----------------------------------------
echo " - fetching manifest and rules from server" | tee -a $LOG
rsync -q "${SERVERIP}::drivers/${PATCHCLASS}/driver-manifest.json" "$CACHE/" 2>/dev/null
rsync -q "${SERVERIP}::drivers/${PATCHCLASS}/driver-rules.sh" "$CACHE/" 2>/dev/null

# -----------------------------------------
# Phase 2: Sync common overlays + postsync.d scripts
# -----------------------------------------
echo " - syncing common overlays from server" | tee -a $LOG
rsync -r "${SERVERIP}::drivers/${PATCHCLASS}/common/" "$CACHE/common/" 2>/dev/null

# Execute postsync.d scripts (driver matching etc.)
if [ -d "$CACHE/common/postsync.d" ]; then
    for SCRIPT in "$CACHE/common/postsync.d"/*; do
        [ -f "$SCRIPT" ] || continue
        chmod 755 "$SCRIPT"
        echo " - executing: $SCRIPT" | tee -a $LOG
        sh "$SCRIPT" 2>&1 | tee -a $LOG
        echo "   ...done (exit $?)." | tee -a $LOG
    done
fi

# -----------------------------------------
# Phase 3: Copy common overlays (WITHOUT drivers/ and postsync.d/)
# -----------------------------------------
if [ -d "$CACHE/common" ]; then
    echo " - patching common to /mnt" | tee -a $LOG
    for ITEM in "$CACHE/common"/*; do
        BASENAME=$(basename "$ITEM")
        # Skip drivers and postsync.d — those are handled above
        case "$BASENAME" in
            drivers|postsync.d|tarpacks) continue ;;
        esac
        if [ -d "$ITEM" ]; then
            cp -ar "$ITEM" /mnt/ 2>&1 | tee -a $LOG
        elif [ -f "$ITEM" ]; then
            cp -a "$ITEM" /mnt/ 2>&1 | tee -a $LOG
        fi
    done
fi

# Tarpacks (common)
if [ -d "$CACHE/common/tarpacks" ]; then
    echo " - unpacking tarpacks from common" | tee -a $LOG
    for pack in "$CACHE/common/tarpacks"/*; do
        [ -f "$pack" ] || continue
        echo "   - unpacking: $pack" | tee -a $LOG
        tar xzf "$pack" -C /mnt 2>&1 | tee -a $LOG
    done
fi

# Timestamp
echo $NOW > /mnt/lastsync

echo "##### POSTSYNC END (patchclass) #####" | tee -a $LOG

# Self-update: ensure postsync script stays current
rsync --progress -r "${SERVERIP}::linbo/images/${IMAGENAME%.qcow2}.postsync" /cache/ 2>/dev/null
