/**
 * LINBO Docker - Images Routes
 * CRUD operations for image management
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
const fs = require('fs').promises;
const path = require('path');

// Images directory from environment
const IMAGES_DIR = process.env.IMAGES_DIR || '/srv/linbo/images';

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
      try {
        const files = await fs.readdir(IMAGES_DIR);
        const imageFiles = files.filter(f =>
          f.endsWith('.qcow2') || f.endsWith('.cloop') || f.endsWith('.torrent')
        );

        const dbFilenames = new Set(dbImages.map(i => i.filename));
        filesystemImages = imageFiles
          .filter(f => !dbFilenames.has(f))
          .map(filename => ({
            filename,
            type: filename.endsWith('.torrent') ? 'torrent' :
                  filename.includes('.qdiff') ? 'differential' : 'base',
            path: path.join(IMAGES_DIR, filename),
            status: 'unregistered',
            isFromFilesystem: true,
          }));
      } catch (err) {
        console.error('Failed to scan images directory:', err);
      }
    }

    // Enhance DB images with file stats
    const enhancedImages = await Promise.all(
      dbImages.map(async (image) => {
        try {
          const stats = await fs.stat(image.path);
          return {
            ...image,
            size: image.size || stats.size,
            fileExists: true,
            modifiedAt: stats.mtime,
          };
        } catch {
          return {
            ...image,
            fileExists: false,
          };
        }
      })
    );

    res.json({
      data: [...enhancedImages, ...filesystemImages],
      summary: {
        total: enhancedImages.length + filesystemImages.length,
        registered: enhancedImages.length,
        unregistered: filesystemImages.length,
        byType: {
          base: enhancedImages.filter(i => i.type === 'base').length,
          differential: enhancedImages.filter(i => i.type === 'differential').length,
          torrent: enhancedImages.filter(i => i.type === 'torrent').length,
        },
      },
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

    // Get file stats
    let fileInfo = { fileExists: false };
    try {
      const stats = await fs.stat(image.path);
      fileInfo = {
        fileExists: true,
        size: stats.size,
        modifiedAt: stats.mtime,
        createdAt: stats.birthtime,
      };
    } catch {
      // File doesn't exist
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

    res.json({
      data: {
        ...image,
        ...fileInfo,
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
      // Check if file exists
      const fullPath = path.join(IMAGES_DIR, req.body.filename);
      let fileStats = null;
      try {
        fileStats = await fs.stat(fullPath);
      } catch {
        // File doesn't exist yet - that's OK for upload placeholder
      }

      const image = await prisma.image.create({
        data: {
          ...req.body,
          path: req.body.path || fullPath,
          size: fileStats ? fileStats.size : req.body.size,
          createdBy: req.user.username,
        },
      });

      // Invalidate cache
      await redis.delPattern('images:*');

      res.status(201).json({ data: image });
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

      const fullPath = path.join(IMAGES_DIR, filename);

      // Check if file exists
      let fileStats;
      try {
        fileStats = await fs.stat(fullPath);
      } catch {
        return res.status(404).json({
          error: {
            code: 'FILE_NOT_FOUND',
            message: `File not found: ${filename}`,
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
          path: fullPath,
          size: fileStats.size,
          description,
          status: 'available',
          createdBy: req.user.username,
          uploadedAt: fileStats.mtime,
        },
      });

      // Invalidate cache
      await redis.delPattern('images:*');

      res.status(201).json({ data: image });
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

      // Optionally delete file
      let fileDeleted = false;
      if (deleteFile === 'true') {
        try {
          await fs.unlink(image.path);
          fileDeleted = true;
        } catch (err) {
          console.error('Failed to delete image file:', err);
        }
      }

      // Invalidate cache
      await redis.delPattern('images:*');

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

      // Compute checksum (in production, this would be async)
      const crypto = require('crypto');
      const stream = require('fs').createReadStream(image.path);
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
      let stats;
      try {
        stats = await fs.stat(image.path);
      } catch {
        return res.status(404).json({
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'Image file not found on disk',
          },
        });
      }

      // For qcow2 images, we could run qemu-img info
      // For now, return basic file info
      res.json({
        data: {
          filename: image.filename,
          type: image.type,
          path: image.path,
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
