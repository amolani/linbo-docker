/**
 * LINBO Docker - Images Routes
 * CRUD operations for image management
 *
 * Production layout: /srv/linbo/images/<base>/<base>.qcow2
 */

const express = require('express');
const router = express.Router();
const { prisma } = require('../lib/prisma');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  validateBody,
  createImageSchema,
  updateImageSchema,
} = require('../middleware/validate');
const { auditAction } = require('../middleware/audit');
const redis = require('../lib/redis');
const ws = require('../lib/websocket');
const fs = require('fs').promises;
const path = require('path');
const {
  IMAGE_EXTS,
  IMAGE_SUPPLEMENTS,
  IMAGES_DIR,
  LINBO_DIR,
  READABLE_TYPES,
  WRITABLE_TYPES,
  parseMainFilename,
  resolveImagePath,
  resolveImageDir,
  resolveFromDbPath,
  resolveSidecarPath,
  resolveSupplementPath,
  toRelativePath,
} = require('../lib/image-path');

/**
 * Enhance a DB image record with file stats and absolutePath.
 */
async function enhanceImage(image) {
  let absolutePath;
  try {
    absolutePath = resolveFromDbPath(image.path);
  } catch {
    absolutePath = null;
  }

  if (!absolutePath) {
    return { ...image, absolutePath: null, fileExists: false };
  }

  try {
    const stats = await fs.stat(absolutePath);
    return {
      ...image,
      absolutePath,
      size: image.size || stats.size,
      fileExists: true,
      modifiedAt: stats.mtime,
    };
  } catch {
    return { ...image, absolutePath, fileExists: false };
  }
}

/**
 * GET /images
 * List all images (DB + filesystem scan)
 */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { type, status } = req.query;

    // Get images from database
    const where = {};
    if (type) where.type = type;
    if (status) where.status = status;

    const dbImages = await prisma.image.findMany({
      where,
      orderBy: { filename: 'asc' },
    });

    // Optionally scan filesystem for unregistered images
    let filesystemImages = [];
    if (req.query.scan === 'true') {
      const dbFilenames = new Set(dbImages.map(i => i.filename));

      // Phase 1: Canonical subdirectories in IMAGES_DIR
      try {
        const entries = await fs.readdir(IMAGES_DIR, { withFileTypes: true });
        const dirs = entries.filter(e => e.isDirectory() && e.name !== 'tmp' && e.name !== 'backups');

        for (const dir of dirs) {
          try {
            const files = await fs.readdir(path.join(IMAGES_DIR, dir.name));
            const imageFiles = files.filter(f => IMAGE_EXTS.some(ext => f.endsWith(ext)));

            for (const f of imageFiles) {
              try {
                const { base } = parseMainFilename(f);
                if (base !== dir.name) {
                  console.warn(`[Images] Non-canonical layout: ${dir.name}/${f} (expected dir=${base})`);
                }
              } catch {
                // Skip files that don't pass validation
                continue;
              }

              if (!dbFilenames.has(f)) {
                const filePath = path.join(IMAGES_DIR, dir.name, f);
                let fileSize = null;
                try {
                  const stat = await fs.stat(filePath);
                  fileSize = stat.size;
                } catch { /* ignore */ }

                filesystemImages.push({
                  filename: f,
                  type: f.includes('.qdiff') ? 'differential' : 'base',
                  path: `images/${dir.name}/${f}`,
                  absolutePath: filePath,
                  size: fileSize,
                  status: 'unregistered',
                  isFromFilesystem: true,
                });
              }
            }
          } catch (err) {
            console.warn(`[Images] Failed to read subdir ${dir.name}:`, err.message);
          }
        }
      } catch (err) {
        console.error('[Images] Failed to scan images directory:', err.message);
      }

      // Phase 2: Legacy flat scan in LINBO_DIR
      try {
        const flatFiles = await fs.readdir(LINBO_DIR);
        const legacyImages = flatFiles.filter(f => IMAGE_EXTS.some(ext => f.endsWith(ext)));
        if (legacyImages.length > 0) {
          console.warn(`[Images] ${legacyImages.length} legacy flat image(s) in ${LINBO_DIR}: ${legacyImages.join(', ')}`);
          console.warn('[Images] → Move to images/<name>/<name>.qcow2 or use POST /images/register');

          for (const f of legacyImages) {
            if (!dbFilenames.has(f)) {
              const filePath = path.join(LINBO_DIR, f);
              let fileSize = null;
              try {
                const stat = await fs.stat(filePath);
                fileSize = stat.size;
              } catch { /* ignore */ }

              filesystemImages.push({
                filename: f,
                type: f.includes('.qdiff') ? 'differential' : 'base',
                path: f,
                absolutePath: filePath,
                size: fileSize,
                status: 'legacy',
                isFromFilesystem: true,
              });
            }
          }
        }
      } catch { /* LINBO_DIR read error */ }

      console.log(`[Images] Scan: ${dbImages.length + filesystemImages.length} images (${dbImages.length} registered, ${filesystemImages.length} unregistered) in ${IMAGES_DIR}`);
    }

    // Enhance DB images with file stats + absolutePath
    let enhancedImages = await Promise.all(dbImages.map(enhanceImage));

    // Optionally add sidecar summary (DB indicators + FS stat for supplements)
    if (req.query.includeSidecars === 'true') {
      enhancedImages = await Promise.all(enhancedImages.map(addSidecarSummary));
    }

    const summary = {
      total: enhancedImages.length + filesystemImages.length,
      registered: enhancedImages.length,
      unregistered: filesystemImages.length,
      imagesDir: IMAGES_DIR,
      byType: {
        base: enhancedImages.filter(i => i.type === 'base').length,
        differential: enhancedImages.filter(i => i.type === 'differential').length,
        torrent: enhancedImages.filter(i => i.type === 'torrent').length,
      },
    };

    res.json({
      data: [...enhancedImages, ...filesystemImages],
      summary,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /images/:id
 * Get single image details
 */
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const image = await prisma.image.findUnique({
      where: { id: req.params.id },
    });

    if (!image) {
      return res.status(404).json({
        error: {
          code: 'IMAGE_NOT_FOUND',
          message: 'Image not found',
        },
      });
    }

    // Resolve absolute path from DB path
    let absolutePath = null;
    let fileInfo = { fileExists: false };
    try {
      absolutePath = resolveFromDbPath(image.path);
      const stats = await fs.stat(absolutePath);
      fileInfo = {
        fileExists: true,
        size: stats.size,
        modifiedAt: stats.mtime,
        createdAt: stats.birthtime,
      };
    } catch {
      // File doesn't exist or path resolution failed
    }

    // Find configs using this image
    const usedBy = await prisma.configOs.findMany({
      where: {
        OR: [
          { baseImage: image.filename },
          { differentialImage: image.filename },
        ],
      },
      include: {
        config: { select: { id: true, name: true } },
      },
    });

    // Get full sidecar details from filesystem
    const sidecars = await getSidecarDetails(image);
    const fileSize = fileInfo.fileExists ? fileInfo.size : null;

    res.json({
      data: {
        ...image,
        absolutePath,
        ...fileInfo,
        fileSize,
        sidecars,
        usedBy: usedBy.map(os => ({
          configId: os.config?.id,
          configName: os.config?.name,
          osName: os.name,
          usage: os.baseImage === image.filename ? 'base' : 'differential',
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /images
 * Register new image
 */
router.post(
  '/',
  authenticateToken,
  requireRole(['admin', 'operator']),
  validateBody(createImageSchema),
  auditAction('image.create', {
    getTargetId: (req, data) => data?.data?.id,
    getTargetName: (req) => req.body.filename,
  }),
  async (req, res, next) => {
    try {
      // Validate and compute paths from filename
      const relPath = toRelativePath(req.body.filename);
      const absPath = resolveImagePath(req.body.filename);
      const imageDir = resolveImageDir(req.body.filename);

      // Ensure image subdirectory exists
      await fs.mkdir(imageDir, { recursive: true });

      // Check if file exists
      let fileStats = null;
      try {
        fileStats = await fs.stat(absPath);
      } catch {
        // File doesn't exist yet - that's OK for upload placeholder
      }

      const image = await prisma.image.create({
        data: {
          filename: req.body.filename,
          type: req.body.type,
          path: relPath,
          size: fileStats ? fileStats.size : req.body.size,
          checksum: req.body.checksum,
          backingImage: req.body.backingImage,
          description: req.body.description,
          status: req.body.status || 'available',
          createdBy: req.user.username,
        },
      });

      // Invalidate cache
      await redis.delPattern('images:*');

      // Broadcast WS event for reactive frontend
      ws.broadcast('image.created', { id: image.id, name: image.filename });

      res.status(201).json({ data: { ...image, absolutePath: absPath } });
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_ENTRY',
            message: 'An image with this filename already exists',
          },
        });
      }
      next(error);
    }
  }
);

/**
 * POST /images/register
 * Register an existing file from filesystem
 */
router.post(
  '/register',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('image.register'),
  async (req, res, next) => {
    try {
      const { filename, description } = req.body;

      if (!filename) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'filename is required',
          },
        });
      }

      // Validate filename and resolve paths
      const relPath = toRelativePath(filename);
      const absPath = resolveImagePath(filename);

      // Check if file exists
      let fileStats;
      try {
        fileStats = await fs.stat(absPath);
      } catch {
        return res.status(404).json({
          error: {
            code: 'FILE_NOT_FOUND',
            message: `File not found: ${absPath}`,
          },
        });
      }

      // Determine type from filename
      let type = 'base';
      if (filename.endsWith('.torrent')) type = 'torrent';
      else if (filename.includes('.qdiff')) type = 'differential';

      // Create image record
      const image = await prisma.image.create({
        data: {
          filename,
          type,
          path: relPath,
          size: fileStats.size,
          description,
          status: 'available',
          createdBy: req.user.username,
          uploadedAt: fileStats.mtime,
        },
      });

      // Invalidate cache
      await redis.delPattern('images:*');

      // Broadcast WS event for reactive frontend
      ws.broadcast('image.created', { id: image.id, name: image.filename });

      res.status(201).json({ data: { ...image, absolutePath: absPath } });
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_ENTRY',
            message: 'This image is already registered',
          },
        });
      }
      next(error);
    }
  }
);

/**
 * PATCH /images/:id
 * Update image metadata
 */
router.patch(
  '/:id',
  authenticateToken,
  requireRole(['admin', 'operator']),
  validateBody(updateImageSchema),
  auditAction('image.update', {
    getTargetName: (req, data) => data?.data?.filename,
  }),
  async (req, res, next) => {
    try {
      const image = await prisma.image.update({
        where: { id: req.params.id },
        data: req.body,
      });

      // Invalidate cache
      await redis.delPattern('images:*');

      // Broadcast WS event for reactive frontend
      ws.broadcast('image.updated', { id: image.id, name: image.filename });

      res.json({ data: image });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: {
            code: 'IMAGE_NOT_FOUND',
            message: 'Image not found',
          },
        });
      }
      next(error);
    }
  }
);

/**
 * DELETE /images/:id
 * Delete image (with confirmation)
 */
router.delete(
  '/:id',
  authenticateToken,
  requireRole(['admin']),
  auditAction('image.delete'),
  async (req, res, next) => {
    try {
      const { deleteFile } = req.query;

      const image = await prisma.image.findUnique({
        where: { id: req.params.id },
      });

      if (!image) {
        return res.status(404).json({
          error: {
            code: 'IMAGE_NOT_FOUND',
            message: 'Image not found',
          },
        });
      }

      // Check if image is in use
      const usageCount = await prisma.configOs.count({
        where: {
          OR: [
            { baseImage: image.filename },
            { differentialImage: image.filename },
          ],
        },
      });

      if (usageCount > 0 && !req.query.force) {
        return res.status(400).json({
          error: {
            code: 'IMAGE_IN_USE',
            message: `Image is used by ${usageCount} OS configurations. Add ?force=true to delete anyway.`,
          },
        });
      }

      // Delete from database
      await prisma.image.delete({
        where: { id: req.params.id },
      });

      // Optionally delete entire image directory (includes backups, sidecars, supplements)
      let fileDeleted = false;
      if (deleteFile === 'true') {
        try {
          const imageDir = resolveImageDir(image.filename);
          await fs.rm(imageDir, { recursive: true, force: true });
          console.log(`[Images] Deleted image directory: ${imageDir}`);
          fileDeleted = true;
        } catch (err) {
          console.error(`[Images] Failed to delete image directory:`, err.message);
        }
      }

      // Invalidate cache
      await redis.delPattern('images:*');

      // Broadcast WS event for reactive frontend
      ws.broadcast('image.deleted', { id: req.params.id });

      res.json({
        data: {
          message: 'Image deleted successfully',
          fileDeleted,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /images/:id/verify
 * Verify image checksum
 */
router.post(
  '/:id/verify',
  authenticateToken,
  requireRole(['admin', 'operator']),
  async (req, res, next) => {
    try {
      const image = await prisma.image.findUnique({
        where: { id: req.params.id },
      });

      if (!image) {
        return res.status(404).json({
          error: {
            code: 'IMAGE_NOT_FOUND',
            message: 'Image not found',
          },
        });
      }

      if (!image.checksum) {
        return res.status(400).json({
          error: {
            code: 'NO_CHECKSUM',
            message: 'No checksum stored for this image',
          },
        });
      }

      // Compute checksum
      const crypto = require('crypto');
      const verifyPath = resolveFromDbPath(image.path);
      const stream = require('fs').createReadStream(verifyPath);
      const hash = crypto.createHash('sha256');

      await new Promise((resolve, reject) => {
        stream.on('data', data => hash.update(data));
        stream.on('end', resolve);
        stream.on('error', reject);
      });

      const computedChecksum = hash.digest('hex');
      const isValid = computedChecksum === image.checksum;

      res.json({
        data: {
          isValid,
          storedChecksum: image.checksum,
          computedChecksum,
          filename: image.filename,
        },
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'Image file not found on disk',
          },
        });
      }
      next(error);
    }
  }
);

/**
 * GET /images/:id/info
 * Get detailed image info (qemu-img info for qcow2)
 */
router.get(
  '/:id/info',
  authenticateToken,
  async (req, res, next) => {
    try {
      const image = await prisma.image.findUnique({
        where: { id: req.params.id },
      });

      if (!image) {
        return res.status(404).json({
          error: {
            code: 'IMAGE_NOT_FOUND',
            message: 'Image not found',
          },
        });
      }

      // Check file exists
      const infoPath = resolveFromDbPath(image.path);
      let stats;
      try {
        stats = await fs.stat(infoPath);
      } catch {
        return res.status(404).json({
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'Image file not found on disk',
          },
        });
      }

      res.json({
        data: {
          filename: image.filename,
          type: image.type,
          path: image.path,
          absolutePath: infoPath,
          size: stats.size,
          sizeFormatted: formatBytes(stats.size),
          modifiedAt: stats.mtime,
          createdAt: stats.birthtime,
          backingImage: image.backingImage,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// Sidecar helpers
// =============================================================================

const MAX_SIDECAR_READ_SIZE = 1 * 1024 * 1024; // 1 MB
const MAX_SIDECAR_WRITE_SIZE = 200 * 1024; // 200 KB

/**
 * Add sidecar summary to an image (for list view).
 * Uses DB indicators for sidecars, FS stat only for supplements.
 */
async function addSidecarSummary(image) {
  const summary = {
    hasInfo: image.imageInfo != null,
    hasDesc: image.description != null,
    hasTorrent: image.torrentFile != null,
    hasMd5: image.checksum != null,
    hasReg: false,
    hasPrestart: false,
    hasPostsync: false,
  };

  // Supplements require FS stat
  try {
    const { base } = parseMainFilename(image.filename);
    for (const [suffix, key] of [['.reg', 'hasReg'], ['.prestart', 'hasPrestart'], ['.postsync', 'hasPostsync']]) {
      try {
        await fs.stat(resolveSupplementPath(image.filename, suffix));
        summary[key] = true;
      } catch { /* not found */ }
    }
  } catch { /* invalid filename */ }

  return { ...image, sidecarSummary: summary };
}

/**
 * Get full sidecar details for a single image (filesystem truth).
 */
async function getSidecarDetails(image) {
  const sidecars = {};
  const sidecarExts = ['.info', '.desc', '.torrent', '.macct', '.md5'];
  const supplementExts = ['.reg', '.prestart', '.postsync'];

  // Sidecars appended to image filename
  for (const ext of sidecarExts) {
    const type = ext.slice(1); // remove leading dot
    try {
      const filePath = resolveSidecarPath(image.filename, ext);
      const stats = await fs.stat(filePath);
      sidecars[type] = { exists: true, size: stats.size, modifiedAt: stats.mtime.toISOString() };
    } catch {
      sidecars[type] = { exists: false };
    }
  }

  // Supplements appended to base name
  for (const ext of supplementExts) {
    const type = ext.slice(1);
    try {
      const filePath = resolveSupplementPath(image.filename, ext);
      const stats = await fs.stat(filePath);
      sidecars[type] = { exists: true, size: stats.size, modifiedAt: stats.mtime.toISOString() };
    } catch {
      sidecars[type] = { exists: false };
    }
  }

  return sidecars;
}

/**
 * Resolve the filesystem path for a sidecar type.
 */
function resolveSidecarTypePath(imageFilename, type) {
  const sidecarTypes = ['info', 'desc', 'torrent', 'macct', 'md5'];
  const supplementTypes = ['reg', 'prestart', 'postsync'];

  if (sidecarTypes.includes(type)) {
    return resolveSidecarPath(imageFilename, '.' + type);
  } else if (supplementTypes.includes(type)) {
    return resolveSupplementPath(imageFilename, '.' + type);
  }
  return null;
}

/**
 * GET /images/:id/sidecars/:type
 * Read a sidecar file content
 */
router.get(
  '/:id/sidecars/:type',
  authenticateToken,
  async (req, res, next) => {
    try {
      const { type } = req.params;

      if (!READABLE_TYPES.includes(type)) {
        return res.status(400).json({
          error: { code: 'INVALID_TYPE', message: `Invalid sidecar type. Allowed: ${READABLE_TYPES.join(', ')}` },
        });
      }

      const image = await prisma.image.findUnique({ where: { id: req.params.id } });
      if (!image) {
        return res.status(404).json({ error: { code: 'IMAGE_NOT_FOUND', message: 'Image not found' } });
      }

      const filePath = resolveSidecarTypePath(image.filename, type);
      if (!filePath) {
        return res.status(400).json({ error: { code: 'INVALID_TYPE', message: 'Unknown sidecar type' } });
      }

      let stats;
      try {
        stats = await fs.stat(filePath);
      } catch {
        return res.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: `Sidecar file .${type} not found` } });
      }

      if (stats.size > MAX_SIDECAR_READ_SIZE) {
        return res.status(413).json({
          error: { code: 'FILE_TOO_LARGE', message: 'File too large for API, access via filesystem' },
        });
      }

      const content = await fs.readFile(filePath, 'utf8');

      res.json({
        data: { type, content, size: stats.size, modifiedAt: stats.mtime.toISOString() },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /images/:id/sidecars/:type
 * Write a sidecar file
 */
router.put(
  '/:id/sidecars/:type',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('image.sidecar.update', {
    getTargetName: (req) => `${req.params.type}`,
  }),
  async (req, res, next) => {
    try {
      const { type } = req.params;

      if (!WRITABLE_TYPES.includes(type)) {
        return res.status(400).json({
          error: { code: 'INVALID_TYPE', message: `Type not writable. Allowed: ${WRITABLE_TYPES.join(', ')}` },
        });
      }

      const { content } = req.body;
      if (content === undefined || typeof content !== 'string') {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'content (string) is required' },
        });
      }

      if (Buffer.byteLength(content, 'utf8') > MAX_SIDECAR_WRITE_SIZE) {
        return res.status(400).json({
          error: { code: 'CONTENT_TOO_LARGE', message: `Content exceeds ${MAX_SIDECAR_WRITE_SIZE / 1024}KB limit` },
        });
      }

      const image = await prisma.image.findUnique({ where: { id: req.params.id } });
      if (!image) {
        return res.status(404).json({ error: { code: 'IMAGE_NOT_FOUND', message: 'Image not found' } });
      }

      const filePath = resolveSidecarTypePath(image.filename, type);
      if (!filePath) {
        return res.status(400).json({ error: { code: 'INVALID_TYPE', message: 'Unknown sidecar type' } });
      }

      // Ensure directory exists
      const imageDir = resolveImageDir(image.filename);
      await fs.mkdir(imageDir, { recursive: true });

      // Write file
      await fs.writeFile(filePath, content, 'utf8');

      // If desc, also update DB
      if (type === 'desc') {
        const trimmed = content.trim();
        await prisma.image.update({
          where: { id: image.id },
          data: { description: trimmed || null },
        });
      }

      // Invalidate cache
      await redis.delPattern('images:*');

      ws.broadcast('image.updated', { id: image.id, name: image.filename, sidecar: type });

      res.json({
        data: { type, size: Buffer.byteLength(content, 'utf8'), message: 'Sidecar updated' },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Format bytes to human readable
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

module.exports = router;
