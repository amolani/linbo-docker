/**
 * LINBO Docker - Host Service
 * Business logic for host management
 */

const { prisma } = require('../lib/prisma');
const redis = require('../lib/redis');
const ws = require('../lib/websocket');

/**
 * Get host by ID with caching
 * @param {string} id - Host UUID
 */
async function getHostById(id) {
  const cacheKey = `host:${id}`;

  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const host = await prisma.host.findUnique({
    where: { id },
    include: {
      room: { select: { id: true, name: true } },
      config: { select: { id: true, name: true } },
    },
  });

  if (host) {
    await redis.set(cacheKey, host, 60); // Cache for 60 seconds
  }

  return host;
}

/**
 * Get host by hostname
 * @param {string} hostname - Host hostname
 */
async function getHostByHostname(hostname) {
  const cacheKey = `host:hostname:${hostname}`;

  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const host = await prisma.host.findUnique({
    where: { hostname },
    include: {
      room: { select: { id: true, name: true } },
      config: { select: { id: true, name: true } },
    },
  });

  if (host) {
    await redis.set(cacheKey, host, 60);
  }

  return host;
}

/**
 * Get host by MAC address
 * @param {string} macAddress - MAC address
 */
async function getHostByMac(macAddress) {
  const normalizedMac = macAddress.replace(/-/g, ':').toLowerCase();
  const cacheKey = `host:mac:${normalizedMac}`;

  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const host = await prisma.host.findFirst({
    where: { macAddress: { equals: normalizedMac, mode: 'insensitive' } },
    include: {
      room: { select: { id: true, name: true } },
      config: { select: { id: true, name: true } },
    },
  });

  if (host) {
    await redis.set(cacheKey, host, 60);
  }

  return host;
}

/**
 * Update host status
 * @param {string} id - Host UUID
 * @param {string} status - New status
 * @param {object} additionalData - Additional data to update
 */
async function updateHostStatus(id, status, additionalData = {}) {
  const host = await prisma.host.update({
    where: { id },
    data: {
      status,
      lastSeen: new Date(),
      ...additionalData,
    },
  });

  // Invalidate cache
  await redis.del(`host:${id}`);
  await redis.del(`host:hostname:${host.hostname}`);
  await redis.del(`host:mac:${host.macAddress.toLowerCase()}`);

  // Broadcast status change
  ws.broadcast('host.status.changed', {
    hostId: host.id,
    hostname: host.hostname,
    status: host.status,
    detectedOs: host.detectedOs || null,
    lastSeen: host.lastSeen,
  });

  return host;
}

/**
 * Bulk update host status for multiple hosts
 * @param {string[]} hostIds - Array of host UUIDs
 * @param {string} status - New status
 * @param {object} additionalData - Additional fields to update
 */
async function bulkUpdateStatus(hostIds, status, additionalData = {}) {
  const result = await prisma.host.updateMany({
    where: { id: { in: hostIds } },
    data: {
      status,
      lastSeen: new Date(),
      ...additionalData,
    },
  });

  // Invalidate cache for all hosts
  await redis.delPattern('host:*');

  // Get updated hosts for broadcast
  const hosts = await prisma.host.findMany({
    where: { id: { in: hostIds } },
    select: { id: true, hostname: true, status: true, detectedOs: true, lastSeen: true },
  });

  // Broadcast status changes
  hosts.forEach(host => {
    ws.broadcast('host.status.changed', {
      hostId: host.id,
      hostname: host.hostname,
      status: host.status,
      detectedOs: host.detectedOs || null,
      lastSeen: host.lastSeen,
    });
  });

  return { count: result.count, hosts };
}

/**
 * Get hosts with stale status (haven't been seen recently)
 * Uses max(lastSeen, lastOnlineAt) — host is stale only when BOTH are old.
 * @param {number} seconds - Seconds since last activity to consider stale
 */
async function getStaleHosts(seconds = 600) {
  const threshold = new Date(Date.now() - seconds * 1000);

  return prisma.host.findMany({
    where: {
      status: 'online',
      OR: [
        // No lastOnlineAt → fall back to lastSeen only
        {
          lastOnlineAt: null,
          lastSeen: { lt: threshold },
        },
        // Both fields exist → both must be stale
        {
          AND: [
            { lastOnlineAt: { not: null } },
            { lastOnlineAt: { lt: threshold } },
            { lastSeen: { lt: threshold } },
          ],
        },
      ],
    },
    select: {
      id: true,
      hostname: true,
      lastSeen: true,
      lastOnlineAt: true,
    },
  });
}

/**
 * Mark stale hosts as offline
 * @param {number} seconds - Seconds since last activity to consider stale
 */
async function markStaleHostsOffline(seconds = 600) {
  const staleHosts = await getStaleHosts(seconds);

  if (staleHosts.length === 0) {
    return { count: 0, hosts: [] };
  }

  const hostIds = staleHosts.map(h => h.id);
  return bulkUpdateStatus(hostIds, 'offline', { detectedOs: null });
}

const OFFLINE_TIMEOUT_SEC = parseInt(process.env.HOST_OFFLINE_TIMEOUT_SEC) || 300;

/**
 * Update host based on scan result. Write-only-on-change — zero DB writes for no-hit scans.
 * @param {string} id - Host UUID
 * @param {object} current - Pre-fetched host state (from batch query)
 * @param {object} scanResult - { isOnline, detectedOs }
 */
async function updateHostScanResult(id, current, { isOnline, detectedOs }) {
  // No-hit scan → no DB write
  if (!isOnline) return null;

  const now = new Date();
  const data = {};
  let changed = false;

  // Status change: was not online → now online
  if (current.status !== 'online') {
    data.status = 'online';
    data.lastSeen = now;
    changed = true;
  }

  // OS change
  if (detectedOs !== undefined && detectedOs !== current.detectedOs) {
    data.detectedOs = detectedOs;
    changed = true;
  }

  // lastOnlineAt throttle: bump only if older than TIMEOUT/2 (or null)
  const bumpMs = (OFFLINE_TIMEOUT_SEC * 1000) / 2;
  const needsBump = !current.lastOnlineAt ||
    (now.getTime() - new Date(current.lastOnlineAt).getTime()) > bumpMs;

  if (!changed && !needsBump) return null; // nothing to do

  if (needsBump) {
    data.lastOnlineAt = now;
    data.lastSeen = now;
  }

  const host = await prisma.host.update({ where: { id }, data });

  // Invalidate cache
  await redis.del(`host:${id}`);
  await redis.del(`host:hostname:${current.hostname}`);
  await redis.del(`host:mac:${current.macAddress.toLowerCase()}`);

  // WS broadcast only on status/OS change (not on pure lastOnlineAt bump)
  if (changed) {
    ws.broadcast('host.status.changed', {
      hostId: host.id,
      hostname: host.hostname,
      status: host.status,
      detectedOs: host.detectedOs || null,
      lastSeen: host.lastSeen,
    });
  }

  return host;
}

/**
 * Get host configuration (start.conf content)
 * @param {string} id - Host UUID
 */
async function getHostConfig(id) {
  const host = await prisma.host.findUnique({
    where: { id },
    include: {
      config: {
        include: {
          partitions: { orderBy: { position: 'asc' } },
          osEntries: { orderBy: { position: 'asc' } },
        },
      },
    },
  });

  if (!host) return null;

  // Use host config
  return host.config || null;
}

/**
 * Calculate sync progress based on session data
 * @param {string} hostId - Host UUID
 */
async function getSyncProgress(hostId) {
  const session = await prisma.session.findFirst({
    where: {
      hostId,
      status: { in: ['pending', 'running'] },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      operation: { select: { commands: true } },
    },
  });

  if (!session) {
    return { syncing: false };
  }

  return {
    syncing: true,
    sessionId: session.id,
    operationId: session.operationId,
    progress: session.progress,
    status: session.status,
    startedAt: session.startedAt,
  };
}

/**
 * Get hosts by room with status counts
 * @param {string} roomId - Room UUID
 */
async function getHostsByRoom(roomId) {
  const hosts = await prisma.host.findMany({
    where: { roomId },
    orderBy: { hostname: 'asc' },
    include: {
      config: { select: { id: true, name: true } },
    },
  });

  const statusCounts = hosts.reduce((acc, host) => {
    acc[host.status] = (acc[host.status] || 0) + 1;
    return acc;
  }, {});

  return { hosts, statusCounts, total: hosts.length };
}

/**
 * Get hosts by config with status counts
 * @param {string} configId - Config UUID
 */
async function getHostsByConfig(configId) {
  const hosts = await prisma.host.findMany({
    where: { configId },
    orderBy: { hostname: 'asc' },
    include: {
      room: { select: { id: true, name: true } },
      config: { select: { id: true, name: true } },
    },
  });

  const statusCounts = hosts.reduce((acc, host) => {
    acc[host.status] = (acc[host.status] || 0) + 1;
    return acc;
  }, {});

  return { hosts, statusCounts, total: hosts.length };
}

module.exports = {
  getHostById,
  getHostByHostname,
  getHostByMac,
  updateHostStatus,
  bulkUpdateStatus,
  getStaleHosts,
  markStaleHostsOffline,
  updateHostScanResult,
  getHostConfig,
  getSyncProgress,
  getHostsByRoom,
  getHostsByConfig,
};
