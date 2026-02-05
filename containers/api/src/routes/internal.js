/**
 * LINBO Docker - Internal Routes
 * Internal API endpoints for RSYNC hooks and service-to-service communication
 */

const express = require('express');
const router = express.Router();
const { prisma } = require('../lib/prisma');
const ws = require('../lib/websocket');
const macctService = require('../services/macct.service');

// Internal API key for service-to-service authentication
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'linbo-internal-secret';

/**
 * Middleware to authenticate internal requests
 */
function authenticateInternal(req, res, next) {
  const apiKey = req.headers['x-internal-key'];

  if (!apiKey || apiKey !== INTERNAL_API_KEY) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing internal API key',
      },
    });
  }

  next();
}

/**
 * POST /internal/rsync-event
 * Handle RSYNC pre/post events from rsync hooks
 */
router.post('/rsync-event', authenticateInternal, async (req, res, next) => {
  try {
    const { event, module, clientIp, request, filename } = req.body;

    console.log(`[Internal] RSYNC event: ${event} from ${clientIp} (${module})`);

    // Try to find the host by IP
    let host = null;
    if (clientIp) {
      host = await prisma.host.findFirst({
        where: { ipAddress: clientIp },
        include: {
          config: { select: { id: true, name: true } },
        },
      });
    }

    // Broadcast event based on type
    switch (event) {
      case 'pre-download':
        ws.broadcast('rsync.download.started', {
          clientIp,
          module,
          request,
          hostname: host?.hostname,
          timestamp: new Date(),
        });

        // Update host last seen
        if (host) {
          await prisma.host.update({
            where: { id: host.id },
            data: { lastSeen: new Date() },
          });
        }
        break;

      case 'post-download':
        ws.broadcast('rsync.download.completed', {
          clientIp,
          module,
          request,
          hostname: host?.hostname,
          timestamp: new Date(),
        });
        break;

      case 'pre-upload':
        ws.broadcast('rsync.upload.started', {
          clientIp,
          module,
          request,
          filename,
          hostname: host?.hostname,
          timestamp: new Date(),
        });

        // Update host status to 'uploading'
        if (host) {
          await prisma.host.update({
            where: { id: host.id },
            data: {
              status: 'uploading',
              lastSeen: new Date(),
            },
          });

          ws.broadcast('host.status.changed', {
            hostId: host.id,
            hostname: host.hostname,
            status: 'uploading',
          });
        }
        break;

      case 'post-upload':
        ws.broadcast('rsync.upload.completed', {
          clientIp,
          module,
          filename,
          hostname: host?.hostname,
          timestamp: new Date(),
        });

        // If it's an image upload, register or update the image
        if (filename && (filename.endsWith('.qcow2') || filename.endsWith('.qdiff'))) {
          await handleImageUpload(filename, clientIp, host);
        }

        // Update host status back to 'online'
        if (host) {
          await prisma.host.update({
            where: { id: host.id },
            data: {
              status: 'online',
              lastSeen: new Date(),
            },
          });

          ws.broadcast('host.status.changed', {
            hostId: host.id,
            hostname: host.hostname,
            status: 'online',
          });
        }
        break;

      default:
        console.log(`[Internal] Unknown RSYNC event: ${event}`);
    }

    res.json({ data: { received: true, event, host: host?.hostname } });
  } catch (error) {
    next(error);
  }
});

/**
 * Handle image upload completion
 */
async function handleImageUpload(filename, clientIp, host) {
  const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
  const fs = require('fs').promises;
  const path = require('path');

  // Determine image type
  const type = filename.endsWith('.qdiff') ? 'differential' : 'base';

  // Check if image already exists in database
  let image = await prisma.image.findFirst({
    where: { filename },
  });

  const filepath = path.join(LINBO_DIR, filename);

  // Get file info
  let size = null;
  let checksum = null;
  try {
    const stat = await fs.stat(filepath);
    size = stat.size;

    // Try to read MD5 file
    try {
      checksum = await fs.readFile(`${filepath}.md5`, 'utf8');
      checksum = checksum.trim();
    } catch (e) {
      // MD5 file doesn't exist
    }
  } catch (e) {
    console.error(`[Internal] Failed to stat ${filepath}:`, e.message);
  }

  if (image) {
    // Update existing image
    await prisma.image.update({
      where: { id: image.id },
      data: {
        size: size ? BigInt(size) : null,
        checksum,
        uploadedAt: new Date(),
        lastUsedAt: new Date(),
        lastUsedBy: host?.hostname,
      },
    });

    ws.broadcast('image.updated', {
      imageId: image.id,
      filename,
      type,
      uploadedBy: host?.hostname,
    });

    console.log(`[Internal] Updated image: ${filename}`);
  } else {
    // Register new image
    const newImage = await prisma.image.create({
      data: {
        filename,
        type,
        path: filepath,
        size: size ? BigInt(size) : null,
        checksum,
        status: 'available',
        uploadedAt: new Date(),
        createdBy: host?.hostname || clientIp,
      },
    });

    ws.broadcast('image.created', {
      imageId: newImage.id,
      filename,
      type,
      uploadedBy: host?.hostname,
    });

    console.log(`[Internal] Registered new image: ${filename}`);
  }
}

/**
 * POST /internal/client-status
 * Update client status (called by LINBO client during boot)
 */
router.post('/client-status', authenticateInternal, async (req, res, next) => {
  try {
    const { clientIp, status, cacheInfo, hardware, osRunning } = req.body;

    if (!clientIp) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'clientIp is required',
        },
      });
    }

    // Find host by IP
    const host = await prisma.host.findFirst({
      where: { ipAddress: clientIp },
    });

    if (!host) {
      // Auto-register unknown host? For now just log
      console.log(`[Internal] Unknown client: ${clientIp}`);
      return res.json({ data: { registered: false, message: 'Unknown client' } });
    }

    // Update host
    const updateData = {
      lastSeen: new Date(),
    };

    if (status) updateData.status = status;
    if (cacheInfo) updateData.cacheInfo = cacheInfo;
    if (hardware) updateData.hardware = hardware;
    if (osRunning) updateData.metadata = { ...(host.metadata || {}), osRunning };

    await prisma.host.update({
      where: { id: host.id },
      data: updateData,
    });

    // Broadcast status change
    ws.broadcast('host.status.changed', {
      hostId: host.id,
      hostname: host.hostname,
      status: status || host.status,
      lastSeen: updateData.lastSeen,
    });

    res.json({
      data: {
        registered: true,
        hostname: host.hostname,
        config: host.configId,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /internal/config/:identifier
 * Get start.conf for a host (by IP or hostname)
 * This endpoint is called by LINBO client to fetch its config
 */
router.get('/config/:identifier', async (req, res, next) => {
  try {
    const { identifier } = req.params;

    // Try to find host by IP or hostname
    let host = await prisma.host.findFirst({
      where: {
        OR: [
          { ipAddress: identifier },
          { hostname: identifier },
        ],
      },
      include: {
        config: {
          include: {
            partitions: { orderBy: { position: 'asc' } },
            osEntries: { orderBy: { position: 'asc' } },
          },
        },
      },
    });

    if (!host) {
      return res.status(404).json({
        error: {
          code: 'HOST_NOT_FOUND',
          message: 'Host not found',
        },
      });
    }

    // Use host config
    const config = host.config;

    if (!config) {
      return res.status(404).json({
        error: {
          code: 'CONFIG_NOT_FOUND',
          message: 'No configuration found for this host',
        },
      });
    }

    // Update last seen
    await prisma.host.update({
      where: { id: host.id },
      data: { lastSeen: new Date() },
    });

    // Generate start.conf content (same logic as configs.js preview)
    const configService = require('../services/config.service');
    const { content } = await configService.generateStartConf(config.id);

    res.type('text/plain').send(content);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /internal/register-host
 * Auto-register a new host during PXE boot
 */
router.post('/register-host', authenticateInternal, async (req, res, next) => {
  try {
    const { hostname, macAddress, ipAddress, groupName } = req.body;

    if (!macAddress) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'macAddress is required',
        },
      });
    }

    // Normalize MAC address
    const normalizedMac = macAddress.replace(/-/g, ':').toLowerCase();

    // Check if host already exists
    let host = await prisma.host.findFirst({
      where: {
        OR: [
          { macAddress: normalizedMac },
          { ipAddress },
        ],
      },
    });

    if (host) {
      // Update existing host
      await prisma.host.update({
        where: { id: host.id },
        data: {
          ipAddress,
          lastSeen: new Date(),
          status: 'online',
        },
      });

      return res.json({
        data: {
          registered: false,
          updated: true,
          hostname: host.hostname,
          hostId: host.id,
        },
      });
    }

    // Find config if specified
    let configId = null;
    if (groupName) {
      // groupName is kept for backwards compatibility, but maps to config
      const config = await prisma.config.findFirst({
        where: { name: groupName },
      });
      if (config) {
        configId = config.id;
      }
    }

    // Create new host
    const generatedHostname = hostname || `linbo-${normalizedMac.replace(/:/g, '')}`;

    host = await prisma.host.create({
      data: {
        hostname: generatedHostname,
        macAddress: normalizedMac,
        ipAddress,
        configId,
        status: 'online',
        lastSeen: new Date(),
      },
    });

    ws.broadcast('host.created', {
      hostId: host.id,
      hostname: host.hostname,
      macAddress: host.macAddress,
    });

    console.log(`[Internal] Auto-registered new host: ${host.hostname} (${host.macAddress})`);

    res.status(201).json({
      data: {
        registered: true,
        updated: false,
        hostname: host.hostname,
        hostId: host.id,
      },
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({
        error: {
          code: 'DUPLICATE_ENTRY',
          message: 'A host with this MAC or hostname already exists',
        },
      });
    }
    next(error);
  }
});

// =============================================================================
// Machine Account (macct) Routes - For DC Worker
// =============================================================================

/**
 * POST /internal/macct-job
 * Create a macct repair job (triggered by rsync hook or manually)
 */
router.post('/macct-job', authenticateInternal, async (req, res, next) => {
  try {
    const { host, school, hwclass } = req.body;

    if (!host) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'host is required',
        },
      });
    }

    const result = await macctService.createMacctRepairJob(
      host,
      school || 'default-school',
      { hwclass, triggeredBy: 'rsync-hook' }
    );

    res.status(result.queued ? 201 : 200).json({
      data: {
        operationId: result.operation.id,
        status: result.queued ? 'queued' : 'already_queued',
        message: result.message,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /internal/operations/:id/status
 * Update operation status (called by DC worker)
 */
router.patch('/operations/:id/status', authenticateInternal, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, result, error, attempt } = req.body;

    if (!status) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'status is required',
        },
      });
    }

    const validStatuses = ['pending', 'running', 'completed', 'failed', 'retrying'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        },
      });
    }

    const operation = await macctService.updateOperationStatus(id, {
      status,
      result,
      error,
      attempt,
    });

    res.json({
      data: {
        operationId: operation.id,
        status: operation.status,
        message: 'Status updated successfully',
      },
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Operation not found',
        },
      });
    }
    next(error);
  }
});

/**
 * POST /internal/operations/:id/retry
 * Retry a failed operation (called by DC worker or admin)
 */
router.post('/operations/:id/retry', authenticateInternal, async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await macctService.retryJob(id);

    if (!result.success) {
      return res.status(400).json({
        error: {
          code: 'RETRY_FAILED',
          message: result.message,
        },
      });
    }

    res.json({
      data: {
        operationId: id,
        attempt: result.attempt,
        message: 'Job re-queued for retry',
      },
    });
  } catch (error) {
    if (error.message === 'Operation not found') {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Operation not found',
        },
      });
    }
    next(error);
  }
});

module.exports = router;
