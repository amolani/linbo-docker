/**
 * LINBO Docker - Host Status Worker
 * Two-layer approach:
 *   Layer 1 (Stale Timeout): marks hosts offline when max(lastSeen, lastOnlineAt) exceeds threshold
 *   Layer 2 (Port Scanner): confirms online + detects OS via TCP port scanning, never sets offline
 */

const net = require('net');
const { prisma } = require('../lib/prisma');
const redis = require('../lib/redis');
const hostService = require('../services/host.service');

// Configuration from ENV
const OFFLINE_TIMEOUT_SEC = parseInt(process.env.HOST_OFFLINE_TIMEOUT_SEC) || 300;
const SCAN_ENABLED = process.env.HOST_SCAN_ENABLED !== 'false';
const SCAN_INTERVAL_SEC = parseInt(process.env.HOST_SCAN_INTERVAL_SEC) || 60;
const SCAN_CONCURRENCY = parseInt(process.env.HOST_SCAN_CONCURRENCY) || 30;
const SCAN_PORT_TIMEOUT_MS = parseInt(process.env.HOST_SCAN_PORT_TIMEOUT_MS) || 500;
const SCAN_STALE_AFTER = parseInt(process.env.HOST_SCAN_STALE_AFTER) || 5;

// Worker state
let isRunning = false;
let staleTimer = null;
let scanTimer = null;
let isScanRunning = false;

// =============================================================================
// Port Scanning
// =============================================================================

/**
 * Check if a TCP port is open on a host
 * @param {string} ip - IP address
 * @param {number} port - Port number
 * @param {number} timeoutMs - Connection timeout in ms
 * @returns {Promise<boolean>}
 */
function checkPort(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    const done = (result) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, ip);
  });
}

/**
 * Scan a host's ports to determine OS
 * Port order with early exit: 2222 → 22 → 135 → 445 → 3389
 * @param {object} host - Host object with ipAddress
 * @param {number} portTimeout - Timeout per port in ms
 * @returns {Promise<{isOnline: boolean, detectedOs: string|undefined}>}
 */
async function scanHost(host, portTimeout) {
  if (!host.ipAddress) {
    return { isOnline: false, detectedOs: undefined };
  }

  // Check LINBO port first (early exit)
  if (await checkPort(host.ipAddress, 2222, portTimeout)) {
    return { isOnline: true, detectedOs: 'linbo' };
  }

  // Check Linux SSH
  if (await checkPort(host.ipAddress, 22, portTimeout)) {
    return { isOnline: true, detectedOs: 'linux' };
  }

  // Check Windows ports (any one confirms Windows)
  const windowsPorts = [135, 445, 3389];
  for (const port of windowsPorts) {
    if (await checkPort(host.ipAddress, port, portTimeout)) {
      return { isOnline: true, detectedOs: 'windows' };
    }
  }

  return { isOnline: false, detectedOs: undefined };
}

/**
 * Run async functions with concurrency limit (manual pool, no npm dependency)
 * @param {Array} items - Items to process
 * @param {Function} fn - Async function to call for each item
 * @param {number} limit - Max concurrent executions
 * @returns {Promise<Array>}
 */
async function runWithConcurrency(items, fn, limit) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return results;
}

// =============================================================================
// Scan Cycle
// =============================================================================

/**
 * Run a complete scan cycle
 */
async function runScanCycle() {
  if (isScanRunning) {
    console.warn('[HostScanner] Previous scan cycle still running, skipping');
    return;
  }

  isScanRunning = true;
  const startTime = Date.now();

  try {
    // Batch-read all hosts with IP addresses at cycle start
    const allHosts = await prisma.host.findMany({
      where: { ipAddress: { not: null } },
      select: {
        id: true,
        hostname: true,
        macAddress: true,
        ipAddress: true,
        status: true,
        detectedOs: true,
        lastOnlineAt: true,
      },
    });

    if (allHosts.length === 0) {
      isScanRunning = false;
      return;
    }

    // Scan all hosts with concurrency limit
    const scanResults = await runWithConcurrency(
      allHosts,
      (host) => scanHost(host, SCAN_PORT_TIMEOUT_MS),
      SCAN_CONCURRENCY
    );

    // Process results
    let onlineHits = 0;
    let statusChanges = 0;
    let osChanges = 0;
    let throttledBumps = 0;
    let osStaleClear = 0;
    let dbWrites = 0;
    let noHit = 0;

    const redisClient = redis.getClient();

    for (let i = 0; i < allHosts.length; i++) {
      const host = allHosts[i];
      const result = scanResults[i];

      if (result.isOnline) {
        onlineHits++;

        // Track what would change for metrics
        const wasNotOnline = host.status !== 'online';
        const osChanged = result.detectedOs !== undefined && result.detectedOs !== host.detectedOs;

        const updated = await hostService.updateHostScanResult(host.id, host, result);

        if (updated) {
          dbWrites++;
          if (wasNotOnline) statusChanges++;
          if (osChanged) osChanges++;
          if (!wasNotOnline && !osChanged) throttledBumps++;
        }

        // Reset fail counter on online hit
        const failsKey = `host:scan:fails:${host.id}`;
        await redisClient.del(failsKey);
      } else {
        noHit++;

        // Increment fail counter in Redis (TTL 24h)
        const failsKey = `host:scan:fails:${host.id}`;
        const fails = await redisClient.incr(failsKey);
        await redisClient.expire(failsKey, 86400);

        // After STALE_AFTER consecutive fails, clear detectedOs (only if non-null)
        if (fails >= SCAN_STALE_AFTER && host.detectedOs != null) {
          await prisma.host.update({
            where: { id: host.id },
            data: { detectedOs: null },
          });
          // Invalidate cache
          await redis.del(`host:${host.id}`);
          await redis.del(`host:hostname:${host.hostname}`);
          await redis.del(`host:mac:${host.macAddress.toLowerCase()}`);

          await redisClient.del(failsKey);
          osStaleClear++;
          dbWrites++;
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Store last scan timestamp for monitoring
    await redisClient.set('host:scan:last', new Date().toISOString(), 'EX', 86400);

    console.log(
      `[HostScanner] cycle scanned=${allHosts.length} onlineHits=${onlineHits} statusChanges=${statusChanges} osChanges=${osChanges} throttledBumps=${throttledBumps} osStaleClear=${osStaleClear} dbWrites=${dbWrites} noHit=${noHit} elapsed=${elapsed}s`
    );
  } catch (error) {
    console.error('[HostScanner] Scan cycle error:', error.message);
  } finally {
    isScanRunning = false;
  }
}

// =============================================================================
// Stale Check
// =============================================================================

/**
 * Run stale host check
 */
async function runStaleCheck() {
  try {
    const result = await hostService.markStaleHostsOffline(OFFLINE_TIMEOUT_SEC);
    if (result.count > 0) {
      console.log(`[HostStatus] Marked ${result.count} stale host(s) offline`);
    }
  } catch (error) {
    console.error('[HostStatus] Stale check error:', error.message);
  }
}

// =============================================================================
// Worker Lifecycle
// =============================================================================

/**
 * Start the host status worker
 */
function startWorker() {
  if (isRunning) {
    console.log('[HostStatus] Already running');
    return;
  }

  isRunning = true;

  // Layer 1: Stale timeout check — runs every TIMEOUT/2 seconds
  const staleIntervalMs = (OFFLINE_TIMEOUT_SEC / 2) * 1000;
  console.log(`[HostStatus] Stale timeout: ${OFFLINE_TIMEOUT_SEC}s (check every ${OFFLINE_TIMEOUT_SEC / 2}s)`);

  // Run stale check immediately, then on interval
  runStaleCheck();
  staleTimer = setInterval(runStaleCheck, staleIntervalMs);

  // Layer 2: Port scanner — runs every SCAN_INTERVAL_SEC seconds
  if (SCAN_ENABLED) {
    console.log(`[HostStatus] Scanner: interval=${SCAN_INTERVAL_SEC}s concurrency=${SCAN_CONCURRENCY} portTimeout=${SCAN_PORT_TIMEOUT_MS}ms staleAfter=${SCAN_STALE_AFTER}`);

    // Delay first scan by 10s to let server fully start
    setTimeout(() => {
      if (!isRunning) return;
      runScanCycle();
      scanTimer = setInterval(runScanCycle, SCAN_INTERVAL_SEC * 1000);
    }, 10000);
  } else {
    console.log('[HostStatus] Scanner disabled');
  }
}

/**
 * Stop the host status worker
 */
function stopWorker() {
  isRunning = false;

  if (staleTimer) {
    clearInterval(staleTimer);
    staleTimer = null;
  }

  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }

  console.log('[HostStatus] Stopped');
}

/**
 * Get worker status
 */
function getStatus() {
  return {
    running: isRunning,
    scanEnabled: SCAN_ENABLED,
    scanRunning: isScanRunning,
    offlineTimeoutSec: OFFLINE_TIMEOUT_SEC,
    scanIntervalSec: SCAN_INTERVAL_SEC,
    scanConcurrency: SCAN_CONCURRENCY,
  };
}

module.exports = {
  startWorker,
  stopWorker,
  getStatus,
  // Exported for testing
  checkPort,
  scanHost,
  runWithConcurrency,
  runScanCycle,
  runStaleCheck,
};
