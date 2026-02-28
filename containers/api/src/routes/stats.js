/**
 * LINBO Docker - Stats Routes
 * Dashboard statistics and overview
 */

const express = require('express');
const router = express.Router();
const { prisma } = require('../lib/prisma');
const { authenticateToken } = require('../middleware/auth');
const redis = require('../lib/redis');
const fs = require('fs').promises;
const path = require('path');
const { IMAGES_DIR } = require('../lib/image-path');

/**
 * GET /stats/overview
 * Dashboard overview statistics
 */
router.get('/overview', authenticateToken, async (req, res, next) => {
  try {
    // Try cache first
    const cacheKey = 'stats:overview';
    const cached = await redis.get(cacheKey);
    if (cached && !req.query.refresh) {
      return res.json({ data: cached, cached: true });
    }

    // Gather stats in parallel
    const [
      hostStats,
      roomCount,
      configCount,
      imageCount,
      recentOperations,
      activeOperations,
      recentActivity,
    ] = await Promise.all([
      // Host statistics
      prisma.host.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      // Counts
      prisma.room.count(),
      prisma.config.count(),
      prisma.image.count(),
      // Recent operations
      prisma.operation.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          commands: true,
          status: true,
          createdAt: true,
          completedAt: true,
          _count: { select: { sessions: true } },
        },
      }),
      // Active operations
      prisma.operation.count({
        where: { status: { in: ['pending', 'running'] } },
      }),
      // Last activity
      prisma.auditLog.findFirst({
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true, action: true, actor: true },
      }),
    ]);

    // Process host stats
    const hostStatusMap = hostStats.reduce((acc, item) => {
      acc[item.status] = item._count.status;
      return acc;
    }, {});

    const totalHosts = Object.values(hostStatusMap).reduce((a, b) => a + b, 0);

    // Get storage info
    let storageInfo = { used: 'N/A', free: 'N/A', total: 'N/A' };
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync(`df -B1 ${IMAGES_DIR} | tail -1`);
      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 4) {
        storageInfo = {
          total: formatBytes(parseInt(parts[1], 10)),
          used: formatBytes(parseInt(parts[2], 10)),
          free: formatBytes(parseInt(parts[3], 10)),
          usedPercent: parts[4],
        };
      }
    } catch {
      // Ignore storage errors
    }

    const stats = {
      hosts: {
        total: totalHosts,
        online: hostStatusMap.online || 0,
        offline: hostStatusMap.offline || 0,
        syncing: hostStatusMap.syncing || 0,
        error: hostStatusMap.error || 0,
      },
      rooms: roomCount,
      configs: configCount,
      images: imageCount,
      operations: {
        active: activeOperations,
        recent: recentOperations.map(op => ({
          id: op.id,
          command: op.commands[0],
          status: op.status,
          hostCount: op._count.sessions,
          createdAt: op.createdAt,
          completedAt: op.completedAt,
        })),
      },
      storage: storageInfo,
      lastActivity: recentActivity,
      generatedAt: new Date().toISOString(),
    };

    // Cache for 30 seconds
    await redis.set(cacheKey, stats, 30);

    res.json({ data: stats });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/hosts
 * Detailed host statistics
 */
router.get('/hosts', authenticateToken, async (req, res, next) => {
  try {
    const [byStatus, byRoom, byConfig, recentlyOnline] = await Promise.all([
      // By status
      prisma.host.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      // By room
      prisma.host.groupBy({
        by: ['roomId'],
        _count: { roomId: true },
      }),
      // By config
      prisma.host.groupBy({
        by: ['configId'],
        _count: { configId: true },
      }),
      // Recently online (last 24h)
      prisma.host.count({
        where: {
          lastSeen: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    // Get room and config names
    const roomIds = byRoom.map(r => r.roomId).filter(Boolean);
    const configIds = byConfig.map(c => c.configId).filter(Boolean);

    const [rooms, configs] = await Promise.all([
      prisma.room.findMany({
        where: { id: { in: roomIds } },
        select: { id: true, name: true },
      }),
      prisma.config.findMany({
        where: { id: { in: configIds } },
        select: { id: true, name: true },
      }),
    ]);

    const roomMap = new Map(rooms.map(r => [r.id, r.name]));
    const configMap = new Map(configs.map(c => [c.id, c.name]));

    res.json({
      data: {
        byStatus: byStatus.map(s => ({
          status: s.status,
          count: s._count.status,
        })),
        byRoom: byRoom.map(r => ({
          roomId: r.roomId,
          roomName: roomMap.get(r.roomId) || 'Unassigned',
          count: r._count.roomId,
        })),
        byConfig: byConfig.map(c => ({
          configId: c.configId,
          configName: configMap.get(c.configId) || 'Unassigned',
          count: c._count.configId,
        })),
        recentlyOnline,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/operations
 * Operation statistics
 */
router.get('/operations', authenticateToken, async (req, res, next) => {
  try {
    const { days = 7 } = req.query;
    const since = new Date(Date.now() - parseInt(days, 10) * 24 * 60 * 60 * 1000);

    const [byStatus, byCommand, timeline] = await Promise.all([
      // By status
      prisma.operation.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since } },
        _count: { status: true },
      }),
      // By command (from first command in array)
      prisma.$queryRaw`
        SELECT commands[1] as command, COUNT(*)::int as count
        FROM operations
        WHERE created_at >= ${since}
        GROUP BY commands[1]
      `,
      // Daily timeline
      prisma.$queryRaw`
        SELECT DATE(created_at) as date, COUNT(*)::int as count
        FROM operations
        WHERE created_at >= ${since}
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `,
    ]);

    res.json({
      data: {
        byStatus: byStatus.map(s => ({
          status: s.status,
          count: s._count.status,
        })),
        byCommand,
        timeline,
        period: { days: parseInt(days, 10), since },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/images
 * Image storage statistics
 */
router.get('/images', authenticateToken, async (req, res, next) => {
  try {
    const images = await prisma.image.findMany({
      select: {
        id: true,
        filename: true,
        type: true,
        size: true,
        status: true,
      },
    });

    // Calculate totals by type
    const byType = images.reduce((acc, img) => {
      if (!acc[img.type]) {
        acc[img.type] = { count: 0, size: BigInt(0) };
      }
      acc[img.type].count++;
      acc[img.type].size += img.size || BigInt(0);
      return acc;
    }, {});

    const totalSize = images.reduce((sum, img) => sum + (img.size || BigInt(0)), BigInt(0));

    // Get actual disk usage (iterate subdirectories)
    let diskUsage = null;
    try {
      const entries = await fs.readdir(IMAGES_DIR, { withFileTypes: true });
      let totalDisk = 0;
      for (const entry of entries) {
        const entryPath = path.join(IMAGES_DIR, entry.name);
        if (entry.isDirectory()) {
          try {
            const subFiles = await fs.readdir(entryPath);
            for (const sf of subFiles) {
              try {
                const stat = await fs.stat(path.join(entryPath, sf));
                totalDisk += stat.size;
              } catch { /* ignore */ }
            }
          } catch { /* ignore */ }
        } else {
          try {
            const stat = await fs.stat(entryPath);
            totalDisk += stat.size;
          } catch { /* ignore */ }
        }
      }
      diskUsage = totalDisk;
    } catch {
      // Ignore
    }

    res.json({
      data: {
        totalImages: images.length,
        totalSize: formatBytes(Number(totalSize)),
        diskUsage: diskUsage ? formatBytes(diskUsage) : null,
        byType: Object.entries(byType).map(([type, data]) => ({
          type,
          count: data.count,
          size: formatBytes(Number(data.size)),
        })),
        byStatus: {
          available: images.filter(i => i.status === 'available').length,
          uploading: images.filter(i => i.status === 'uploading').length,
          error: images.filter(i => i.status === 'error').length,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/audit
 * Audit log statistics
 */
router.get('/audit', authenticateToken, async (req, res, next) => {
  try {
    const { days = 7 } = req.query;
    const since = new Date(Date.now() - parseInt(days, 10) * 24 * 60 * 60 * 1000);

    const [byAction, byActor, byStatus] = await Promise.all([
      prisma.auditLog.groupBy({
        by: ['action'],
        where: { timestamp: { gte: since } },
        _count: { action: true },
        orderBy: { _count: { action: 'desc' } },
        take: 10,
      }),
      prisma.auditLog.groupBy({
        by: ['actor'],
        where: { timestamp: { gte: since } },
        _count: { actor: true },
        orderBy: { _count: { actor: 'desc' } },
        take: 10,
      }),
      prisma.auditLog.groupBy({
        by: ['status'],
        where: { timestamp: { gte: since } },
        _count: { status: true },
      }),
    ]);

    res.json({
      data: {
        byAction: byAction.map(a => ({
          action: a.action,
          count: a._count.action,
        })),
        byActor: byActor.map(a => ({
          actor: a.actor,
          count: a._count.actor,
        })),
        byStatus: byStatus.map(s => ({
          status: s.status || 'unknown',
          count: s._count.status,
        })),
        period: { days: parseInt(days, 10), since },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Format bytes to human readable
 */
function formatBytes(bytes, decimals = 2) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

module.exports = router;
