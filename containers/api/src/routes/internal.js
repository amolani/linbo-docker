/**
 * LINBO Docker - Internal Routes
 * Internal API endpoints for RSYNC hooks and service-to-service communication
 */

const express = require('express');
const router = express.Router();
const { prisma } = require('../lib/prisma');
const ws = require('../lib/websocket');
const macctService = require('../services/macct.service');
const provisioningService = require('../services/provisioning.service');

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
    const { event, module, clientIp, request, filename, relativePath } = req.body;

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

        // Update host last seen + mark online
        if (host) {
          const wasOffline = host.status !== 'online';
          const now = new Date();
          await prisma.host.update({
            where: { id: host.id },
            data: { lastSeen: now, lastOnlineAt: now, status: 'online' },
          });
          if (wasOffline) {
            ws.broadcast('host.status.changed', {
              hostId: host.id,
              hostname: host.hostname,
              status: 'online',
              previousStatus: host.status,
              timestamp: new Date(),
            });
          }
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

        // Handle image or sidecar upload
        if (filename) {
          const { IMAGE_EXTS, parseSidecarFilename } = require('../lib/image-path');
          if (IMAGE_EXTS.some(ext => filename.endsWith(ext))) {
            await handleImageUpload(filename, clientIp, host, relativePath);
          } else {
            const sidecar = parseSidecarFilename(filename);
            if (sidecar) {
              await handleSidecarUpload(sidecar.imageFilename, sidecar.sidecarExt, clientIp);
            }
          }
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
async function handleImageUpload(filename, clientIp, host, relativePath) {
  const {
    parseMainFilename,
    resolveImageDir,
    resolveImagePath,
    resolveSidecarPath,
    toRelativePath,
  } = require('../lib/image-path');
  const fs = require('fs').promises;

  // Validate filename
  let parsed;
  try {
    parsed = parseMainFilename(filename);
  } catch (err) {
    console.error(`[Internal] Invalid image filename "${filename}": ${err.message}`);
    return;
  }

  // Validate relativePath from rsync hook (informational)
  const expectedRelPath = toRelativePath(filename);
  const normalizedRelPath = (relativePath || '').replace(/^\/+/, '');
  if (normalizedRelPath && normalizedRelPath !== expectedRelPath) {
    console.warn(`[Internal] rsync relativePath mismatch: got="${normalizedRelPath}", expected="${expectedRelPath}" — using server-computed`);
  }

  // Ensure image subdirectory exists
  const imageDir = resolveImageDir(filename);
  try {
    await fs.mkdir(imageDir, { recursive: true });
  } catch (err) {
    console.error(`[Internal] Failed to create image dir ${imageDir}:`, err.message);
  }

  // Determine image type
  const type = filename.endsWith('.qdiff') ? 'differential' : 'base';

  // Check if image already exists in database
  let image = await prisma.image.findFirst({
    where: { filename },
  });

  const { LINBO_DIR } = require('../lib/image-path');
  const path = require('path');
  const filepath = resolveImagePath(filename);
  const relPath = toRelativePath(filename);

  // Get file info — check canonical path first, then flat path as fallback
  let size = null;
  let checksum = null;
  let actualFilePath = filepath;
  try {
    const stat = await fs.stat(filepath);
    size = stat.size;
  } catch {
    // Fallback: check flat path (legacy client uploaded to /srv/linbo/<filename>)
    const flatPath = path.join(LINBO_DIR, filename);
    try {
      const stat = await fs.stat(flatPath);
      size = stat.size;
      actualFilePath = flatPath;
      // Move flat file to canonical subdirectory
      console.warn(`[Internal] Legacy flat upload detected: ${flatPath} → ${filepath}`);
      try {
        await fs.rename(flatPath, filepath);
        actualFilePath = filepath;
        console.log(`[Internal] Moved ${filename} to ${filepath}`);
        // Also move sidecars if they exist
        for (const sfx of ['.md5', '.info', '.desc', '.torrent', '.macct']) {
          try {
            await fs.rename(flatPath + sfx, filepath + sfx);
          } catch { /* sidecar doesn't exist */ }
        }
      } catch (moveErr) {
        console.error(`[Internal] Failed to move ${flatPath} → ${filepath}:`, moveErr.message);
      }
    } catch {
      console.error(`[Internal] Image file not found at ${filepath} or ${flatPath}`);
    }
  }

  // Try to read MD5 sidecar
  try {
    const md5Path = resolveSidecarPath(filename, '.md5');
    checksum = await fs.readFile(md5Path, 'utf8');
    checksum = checksum.trim();
  } catch {
    // Also check flat MD5 as fallback
    try {
      const flatMd5 = path.join(LINBO_DIR, filename + '.md5');
      checksum = await fs.readFile(flatMd5, 'utf8');
      checksum = checksum.trim();
    } catch {
      // MD5 file doesn't exist
    }
  }

  let imageId;
  if (image) {
    // Update existing image (also fix path if it was legacy)
    await prisma.image.update({
      where: { id: image.id },
      data: {
        path: relPath,
        size: size ? BigInt(size) : null,
        checksum,
        uploadedAt: new Date(),
        lastUsedAt: new Date(),
        lastUsedBy: host?.hostname,
      },
    });
    imageId = image.id;

    ws.broadcast('image.updated', {
      imageId: image.id,
      filename,
      type,
      uploadedBy: host?.hostname,
    });

    console.log(`[Internal] Updated image: ${filename} (path=${relPath})`);
  } else {
    // Register new image
    const newImage = await prisma.image.create({
      data: {
        filename,
        type,
        path: relPath,
        size: size ? BigInt(size) : null,
        checksum,
        status: 'available',
        uploadedAt: new Date(),
        createdBy: host?.hostname || clientIp,
      },
    });
    imageId = newImage.id;

    ws.broadcast('image.created', {
      imageId: newImage.id,
      filename,
      type,
      uploadedBy: host?.hostname,
    });

    console.log(`[Internal] Registered new image: ${filename} (path=${relPath})`);
  }

  // Catch up sidecars that may have arrived before the image
  await catchUpSidecars(filename, imageId);
}

// =============================================================================
// Sidecar handling
// =============================================================================

/**
 * Rate-limited warning for sidecars arriving before their image
 */
const sidecarWarnCache = new Map();
const SIDECAR_WARN_MAX = 200;
const SIDECAR_WARN_TTL = 10 * 60 * 1000;

function shouldWarnSidecarBeforeImage(imageFilename) {
  const now = Date.now();
  // Cleanup old entries when map is full
  if (sidecarWarnCache.size > SIDECAR_WARN_MAX) {
    for (const [k, v] of sidecarWarnCache) {
      if (now - v > SIDECAR_WARN_TTL) sidecarWarnCache.delete(k);
    }
  }
  const last = sidecarWarnCache.get(imageFilename);
  if (last && now - last < 60_000) return false; // max 1x/min per filename
  sidecarWarnCache.set(imageFilename, now);
  return true;
}

/**
 * Parse .info timestamp format "202601271107" → ISO string (UTC)
 */
function parseInfoTimestamp(raw) {
  if (!raw || typeof raw !== 'string' || raw.length < 12) return null;
  const clean = raw.replace(/['"]/g, '');
  if (clean.length < 12) return null;
  const year = parseInt(clean.slice(0, 4), 10);
  const month = parseInt(clean.slice(4, 6), 10) - 1; // 0-indexed
  const day = parseInt(clean.slice(6, 8), 10);
  const hour = parseInt(clean.slice(8, 10), 10);
  const min = parseInt(clean.slice(10, 12), 10);
  if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hour) || isNaN(min)) return null;
  const d = new Date(Date.UTC(year, month, day, hour, min));
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Read and parse a .info file for an image.
 * Returns { imageInfo, infoUpdatedAt, size?, uploadedAt? } or null.
 */
async function readInfoFile(imageFilename) {
  const { resolveSidecarPath, INFO_KEYS } = require('../lib/image-path');
  const fs = require('fs').promises;

  const infoPath = resolveSidecarPath(imageFilename, '.info');
  let content;
  try {
    content = await fs.readFile(infoPath, 'utf8');
  } catch {
    return null;
  }

  const parsed = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+)="(.*)"/);
    if (match) {
      const [, key, value] = match;
      if (INFO_KEYS.includes(key)) {
        parsed[key] = value;
      }
    }
  }

  // Cross-check image field
  if (parsed.image && parsed.image !== imageFilename) {
    if (shouldWarnSidecarBeforeImage(`info-mismatch:${imageFilename}`)) {
      console.warn(`[Internal] .info image mismatch: file says "${parsed.image}", expected "${imageFilename}"`);
    }
  }

  const result = { imageInfo: { ...parsed }, infoUpdatedAt: new Date() };

  // Parse timestamp
  if (parsed.timestamp) {
    const isoTs = parseInfoTimestamp(parsed.timestamp);
    if (isoTs) {
      result.imageInfo.timestampRaw = parsed.timestamp;
      result.imageInfo.timestamp = isoTs;
      result.uploadedAt = new Date(isoTs);
    }
  }

  // Parse imagesize → size
  if (parsed.imagesize) {
    const sizeNum = parseInt(parsed.imagesize, 10);
    if (!isNaN(sizeNum) && sizeNum > 0) {
      result.size = sizeNum;
    }
  }

  return result;
}

/**
 * Handle sidecar file upload (called when rsync uploads .info, .desc, etc.)
 */
async function handleSidecarUpload(imageFilename, sidecarExt, clientIp) {
  const fs = require('fs').promises;
  const { resolveSidecarPath } = require('../lib/image-path');

  // Look up the parent image in DB
  const image = await prisma.image.findFirst({ where: { filename: imageFilename } });
  if (!image) {
    if (shouldWarnSidecarBeforeImage(imageFilename)) {
      console.warn(`[Internal] Sidecar ${sidecarExt} for unknown image "${imageFilename}" — will be caught up on image registration`);
    }
    return;
  }

  const updateData = {};

  switch (sidecarExt) {
    case '.info': {
      const info = await readInfoFile(imageFilename);
      if (info) {
        updateData.imageInfo = info.imageInfo;
        updateData.infoUpdatedAt = info.infoUpdatedAt;
        if (info.size) updateData.size = BigInt(info.size);
        if (info.uploadedAt) updateData.uploadedAt = info.uploadedAt;
      }
      break;
    }
    case '.desc': {
      try {
        const descPath = resolveSidecarPath(imageFilename, '.desc');
        const content = await fs.readFile(descPath, 'utf8');
        const trimmed = content.trim();
        updateData.description = trimmed || null;
      } catch { /* file not readable */ }
      break;
    }
    case '.torrent': {
      try {
        const torrentPath = resolveSidecarPath(imageFilename, '.torrent');
        await fs.stat(torrentPath); // verify exists
        const { parseMainFilename } = require('../lib/image-path');
        const { base } = parseMainFilename(imageFilename);
        updateData.torrentFile = `images/${base}/${imageFilename}.torrent`;
      } catch { /* file not found */ }
      break;
    }
    case '.md5': {
      try {
        const md5Path = resolveSidecarPath(imageFilename, '.md5');
        const content = await fs.readFile(md5Path, 'utf8');
        const hash = content.trim().split(/\s/)[0];
        if (hash) updateData.checksum = hash;
      } catch { /* file not readable */ }
      break;
    }
    case '.macct': {
      console.log(`[Internal] Machine account file uploaded for ${imageFilename}`);
      break;
    }
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.image.update({ where: { id: image.id }, data: updateData });
    ws.broadcast('image.updated', { imageId: image.id, filename: imageFilename, sidecar: sidecarExt });
    console.log(`[Internal] Sidecar ${sidecarExt} processed for ${imageFilename}: ${Object.keys(updateData).join(', ')}`);
  }
}

/**
 * Catch up sidecars that may have arrived before the image was registered.
 * Called after every image registration/re-upload.
 */
async function catchUpSidecars(imageFilename, imageId) {
  const fs = require('fs').promises;
  const { resolveSidecarPath, parseMainFilename } = require('../lib/image-path');

  const updateData = {};
  const caughtUp = [];

  // .info
  const info = await readInfoFile(imageFilename);
  if (info) {
    updateData.imageInfo = info.imageInfo;
    updateData.infoUpdatedAt = info.infoUpdatedAt;
    if (info.size) updateData.size = BigInt(info.size);
    if (info.uploadedAt) updateData.uploadedAt = info.uploadedAt;
    caughtUp.push('.info');
  }

  // .desc
  try {
    const descPath = resolveSidecarPath(imageFilename, '.desc');
    const content = await fs.readFile(descPath, 'utf8');
    const trimmed = content.trim();
    updateData.description = trimmed || null;
    caughtUp.push('.desc');
  } catch { /* not found */ }

  // .torrent
  try {
    const torrentPath = resolveSidecarPath(imageFilename, '.torrent');
    await fs.stat(torrentPath);
    const { base } = parseMainFilename(imageFilename);
    updateData.torrentFile = `images/${base}/${imageFilename}.torrent`;
    caughtUp.push('.torrent');
  } catch { /* not found */ }

  // .md5 — checksum may already be set by handleImageUpload, only override if not set
  try {
    const md5Path = resolveSidecarPath(imageFilename, '.md5');
    const content = await fs.readFile(md5Path, 'utf8');
    const hash = content.trim().split(/\s/)[0];
    if (hash) {
      updateData.checksum = hash;
      caughtUp.push('.md5');
    }
  } catch { /* not found */ }

  if (Object.keys(updateData).length > 0) {
    await prisma.image.update({ where: { id: imageId }, data: updateData });
    console.log(`[Internal] Caught up sidecars for ${imageFilename}: ${caughtUp.join(', ')}`);
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

    // Dispatch by operation type
    const op = await prisma.operation.findUnique({ where: { id }, select: { type: true } });
    if (!op) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Operation not found' },
      });
    }

    let operation;
    if (op.type === 'provision_host') {
      operation = await provisioningService.updateProvisionStatus(id, { status, result, error, attempt });
    } else {
      operation = await macctService.updateOperationStatus(id, { status, result, error, attempt });
    }

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

    // Dispatch by operation type
    const op = await prisma.operation.findUnique({ where: { id }, select: { type: true } });
    if (!op) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Operation not found' },
      });
    }

    let result;
    if (op.type === 'provision_host') {
      result = await provisioningService.retryProvisionJob(id);
    } else {
      result = await macctService.retryJob(id);
    }

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

/**
 * GET /internal/operations/:id
 * Get full operation details (used by DC worker to fetch Operation.options)
 */
router.get('/operations/:id', authenticateInternal, async (req, res, next) => {
  try {
    const operation = await prisma.operation.findUnique({
      where: { id: req.params.id },
    });

    if (!operation) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Operation not found',
        },
      });
    }

    res.json({ data: operation });
  } catch (error) {
    next(error);
  }
});

// Export internals for testing
router._testExports = {
  parseInfoTimestamp,
  readInfoFile,
  handleSidecarUpload,
  catchUpSidecars,
  shouldWarnSidecarBeforeImage,
  sidecarWarnCache,
};

module.exports = router;
