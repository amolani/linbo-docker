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
      group: { select: { id: true, name: true } },
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
      group: { select: { id: true, name: true } },
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
      group: { select: { id: true, name: true } },
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
    lastSeen: host.lastSeen,
  });

  return host;
}

/**
 * Bulk update host status for multiple hosts
 * @param {string[]} hostIds - Array of host UUIDs
 * @param {string} status - New status
 */
async function bulkUpdateStatus(hostIds, status) {
  const result = await prisma.host.updateMany({
    where: { id: { in: hostIds } },
    data: {
      status,
      lastSeen: new Date(),
    },
  });

  // Invalidate cache for all hosts
  await redis.delPattern('host:*');

  // Get updated hosts for broadcast
  const hosts = await prisma.host.findMany({
    where: { id: { in: hostIds } },
    select: { id: true, hostname: true, status: true, lastSeen: true },
  });

  // Broadcast status changes
  hosts.forEach(host => {
    ws.broadcast('host.status.changed', {
      hostId: host.id,
      hostname: host.hostname,
      status: host.status,
      lastSeen: host.lastSeen,
    });
  });

  return { count: result.count, hosts };
}

/**
 * Get hosts with stale status (haven't been seen recently)
 * @param {number} minutes - Minutes since last seen to consider stale
 */
async function getStaleHosts(minutes = 10) {
  const threshold = new Date(Date.now() - minutes * 60 * 1000);

  return prisma.host.findMany({
    where: {
      status: 'online',
      lastSeen: { lt: threshold },
    },
    select: {
      id: true,
      hostname: true,
      lastSeen: true,
    },
  });
}

/**
 * Mark stale hosts as offline
 * @param {number} minutes - Minutes since last seen to consider stale
 */
async function markStaleHostsOffline(minutes = 10) {
  const staleHosts = await getStaleHosts(minutes);

  if (staleHosts.length === 0) {
    return { count: 0, hosts: [] };
  }

  const hostIds = staleHosts.map(h => h.id);
  return bulkUpdateStatus(hostIds, 'offline');
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
      group: {
        include: {
          defaultConfig: {
            include: {
              partitions: { orderBy: { position: 'asc' } },
              osEntries: { orderBy: { position: 'asc' } },
            },
          },
        },
      },
    },
  });

  if (!host) return null;

  // Use host-specific config, or fall back to group default
  return host.config || host.group?.defaultConfig || null;
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
      group: { select: { id: true, name: true } },
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
 * Get hosts by group with status counts
 * @param {string} groupId - Group UUID
 */
async function getHostsByGroup(groupId) {
  const hosts = await prisma.host.findMany({
    where: { groupId },
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
  getHostConfig,
  getSyncProgress,
  getHostsByRoom,
  getHostsByGroup,
};
