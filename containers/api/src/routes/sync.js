/**
 * LINBO Docker - Sync Routes
 * Manual sync trigger, status, and read endpoints for synced data.
 *
 * Read endpoints serve data from Redis (populated by sync.service.js).
 * GET /sync/mode is public (needed before login).
 * All other endpoints require authentication.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const syncService = require('../services/sync.service');
const redis = require('../lib/redis');
const { KEY, loadAllHostsFromRedis, loadAllConfigsFromRedis } = syncService;

const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';

// Auth middleware (always available since middleware/auth.js is Prisma-optional)
let authenticate, requireAdmin;
try {
  const auth = require('../middleware/auth');
  authenticate = auth.authenticateToken;
  requireAdmin = auth.requireRole(['admin']);
} catch {
  // Fallback: allow all if auth middleware not available
  authenticate = (req, res, next) => next();
  requireAdmin = (req, res, next) => next();
}

// ---------------------------------------------------------------------------
// GET /sync/mode — Public (no auth required, needed before login)
// ---------------------------------------------------------------------------
router.get('/mode', (req, res) => {
  const syncEnabled = process.env.SYNC_ENABLED === 'true' || !!process.env.LMN_API_URL;
  const standaloneEnabled = !!process.env.DATABASE_URL;

  let mode = 'offline';
  if (syncEnabled) mode = 'sync';
  else if (standaloneEnabled) mode = 'standalone';

  res.json({
    data: {
      mode,
      syncEnabled,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /sync/status — Existing: sync cursor, counts, LMN API health
// ---------------------------------------------------------------------------
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const status = await syncService.getSyncStatus();
    res.json({ data: status });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /sync/hosts — List hosts from Redis with runtime status
// ---------------------------------------------------------------------------
router.get('/hosts', authenticate, async (req, res, next) => {
  try {
    const client = redis.getClient();
    const hosts = await loadAllHostsFromRedis(client);

    // Merge runtime status from host:status:{ip} hashes
    const enriched = await Promise.all(hosts.map(async (host) => {
      let runtimeStatus = 'offline';
      let lastSeen = null;

      if (host.ip) {
        try {
          const statusData = await client.hgetall(`host:status:${host.ip}`);
          if (statusData && statusData.status) {
            runtimeStatus = statusData.status;
            lastSeen = statusData.lastSeen || null;
          }
        } catch { /* ignore */ }
      }

      return { ...host, runtimeStatus, lastSeen };
    }));

    // Apply filters
    let filtered = enriched;

    const { search, hostgroup } = req.query;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(h =>
        (h.hostname && h.hostname.toLowerCase().includes(q)) ||
        (h.mac && h.mac.toLowerCase().includes(q)) ||
        (h.ip && h.ip.includes(q))
      );
    }

    if (hostgroup) {
      filtered = filtered.filter(h => h.hostgroup === hostgroup);
    }

    res.json({ data: filtered });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /sync/hosts/:mac — Single host from Redis
// ---------------------------------------------------------------------------
router.get('/hosts/:mac', authenticate, async (req, res, next) => {
  try {
    const client = redis.getClient();
    const hostJson = await client.get(`${KEY.HOST}${req.params.mac}`);

    if (!hostJson) {
      return res.status(404).json({
        error: {
          code: 'HOST_NOT_FOUND',
          message: `Host with MAC ${req.params.mac} not found in sync cache`,
        },
      });
    }

    const host = JSON.parse(hostJson);

    // Merge runtime status
    let runtimeStatus = 'offline';
    let lastSeen = null;
    if (host.ip) {
      try {
        const statusData = await client.hgetall(`host:status:${host.ip}`);
        if (statusData && statusData.status) {
          runtimeStatus = statusData.status;
          lastSeen = statusData.lastSeen || null;
        }
      } catch { /* ignore */ }
    }

    res.json({ data: { ...host, runtimeStatus, lastSeen } });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /sync/configs — List configs from Redis
// ---------------------------------------------------------------------------
router.get('/configs', authenticate, async (req, res, next) => {
  try {
    const client = redis.getClient();
    const configs = await loadAllConfigsFromRedis(client);
    res.json({ data: configs });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /sync/configs/:id — Single config from Redis
// ---------------------------------------------------------------------------
router.get('/configs/:id', authenticate, async (req, res, next) => {
  try {
    const client = redis.getClient();
    const configJson = await client.get(`${KEY.CONFIG}${req.params.id}`);

    if (!configJson) {
      return res.status(404).json({
        error: {
          code: 'CONFIG_NOT_FOUND',
          message: `Config '${req.params.id}' not found in sync cache`,
        },
      });
    }

    res.json({ data: JSON.parse(configJson) });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /sync/configs/:id/preview — Read start.conf file from filesystem
// ---------------------------------------------------------------------------
router.get('/configs/:id/preview', authenticate, async (req, res, next) => {
  try {
    const filePath = path.join(LINBO_DIR, `start.conf.${req.params.id}`);

    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({
          error: {
            code: 'FILE_NOT_FOUND',
            message: `start.conf.${req.params.id} not found on filesystem`,
          },
        });
      }
      throw err;
    }

    res.json({ data: { content } });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /sync/stats — Aggregated statistics
// ---------------------------------------------------------------------------
router.get('/stats', authenticate, async (req, res, next) => {
  try {
    const client = redis.getClient();

    // Host counts
    const totalHosts = await client.scard(KEY.HOST_INDEX);

    // Count online hosts by scanning host:status:* keys
    let onlineHosts = 0;
    try {
      const hosts = await loadAllHostsFromRedis(client);
      const statusChecks = await Promise.all(hosts.map(async (h) => {
        if (!h.ip) return false;
        try {
          const statusData = await client.hgetall(`host:status:${h.ip}`);
          return statusData && statusData.status === 'online';
        } catch {
          return false;
        }
      }));
      onlineHosts = statusChecks.filter(Boolean).length;
    } catch { /* ignore */ }

    // Config count
    const totalConfigs = await client.scard(KEY.CONFIG_INDEX);

    // Sync metadata
    const syncStatus = await syncService.getSyncStatus();

    // LMN API health (already in syncStatus)
    const lmnApiHealthy = syncStatus.lmnApiHealthy;

    const hostOfflineTimeoutSec = Number(process.env.HOST_OFFLINE_TIMEOUT_SEC || 300);

    res.json({
      data: {
        hosts: {
          total: Number(totalHosts),
          online: onlineHosts,
          offline: Number(totalHosts) - onlineHosts,
        },
        configs: Number(totalConfigs),
        sync: {
          cursor: syncStatus.cursor,
          lastSyncAt: syncStatus.lastSyncAt,
          isRunning: syncStatus.isRunning,
          lastError: syncStatus.lastError,
        },
        lmnApiHealthy,
        hostOfflineTimeoutSec,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /sync/trigger — Trigger a sync cycle (admin only)
// ---------------------------------------------------------------------------
router.post('/trigger', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { success, stats } = await syncService.syncOnce();
    res.json({
      data: {
        success,
        stats,
        message: 'Sync completed successfully',
      },
    });
  } catch (error) {
    if (error.message === 'Sync already in progress') {
      return res.status(409).json({
        error: {
          code: 'SYNC_IN_PROGRESS',
          message: 'A sync is already running. Please wait.',
        },
      });
    }
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /sync/reset — Reset sync cursor (admin only)
// ---------------------------------------------------------------------------
router.post('/reset', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await syncService.resetSync();
    res.json({
      data: {
        message: 'Sync cursor reset. Next trigger will perform a full sync.',
      },
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================================================
// Image Sync Endpoints
// ===========================================================================
let imageSyncService;
try {
  imageSyncService = require('../services/image-sync.service');
} catch (err) {
  console.warn('[Sync] Image sync service not available:', err.message);
}

// ---------------------------------------------------------------------------
// GET /sync/images/compare — Remote vs. local image comparison
// ---------------------------------------------------------------------------
router.get('/images/compare', authenticate, async (req, res, next) => {
  if (!imageSyncService) {
    return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Image sync service not available' } });
  }
  try {
    const comparison = await imageSyncService.compareImages();
    res.json({ data: comparison });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /sync/images/pull — Start image download (admin only)
// ---------------------------------------------------------------------------
router.post('/images/pull', authenticate, requireAdmin, async (req, res, next) => {
  if (!imageSyncService) {
    return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Image sync service not available' } });
  }
  try {
    const { imageName, all } = req.body;

    if (all) {
      // Pull all remote-only or outdated images
      const comparison = await imageSyncService.compareImages();
      const toPull = comparison.filter(i => i.status === 'remote_only' || i.status === 'outdated');
      const jobs = [];
      for (const img of toPull) {
        const job = await imageSyncService.pullImage(img.name);
        jobs.push(job);
      }
      return res.json({ data: { jobs, count: jobs.length } });
    }

    if (!imageName) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'imageName or all:true required' } });
    }

    const job = await imageSyncService.pullImage(imageName);
    res.json({ data: job });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /sync/images/queue — Current download queue
// ---------------------------------------------------------------------------
router.get('/images/queue', authenticate, async (req, res, next) => {
  if (!imageSyncService) {
    return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Image sync service not available' } });
  }
  try {
    const queue = await imageSyncService.getQueue();
    res.json({ data: queue });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /sync/images/queue/:jobId — Cancel a download job
// ---------------------------------------------------------------------------
router.delete('/images/queue/:jobId', authenticate, requireAdmin, async (req, res, next) => {
  if (!imageSyncService) {
    return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Image sync service not available' } });
  }
  try {
    const result = await imageSyncService.cancelJob(req.params.jobId);
    if (!result.cancelled) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: result.error } });
    }
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
