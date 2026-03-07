/**
 * LINBO Docker - GRUB Theme Sub-Router
 * 10 endpoints: grub-theme GET/PUT/reset, icons list/serve/upload/delete,
 * logo serve/upload/reset
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { auditAction } = require('../../middleware/audit');
const ws = require('../../lib/websocket');
const { z } = require('zod');
const multer = require('multer');
const path = require('path');
const os = require('os');
const fsSync = require('fs');
const fs = require('fs').promises;
const grubThemeService = require('../../services/grub-theme.service');

// Multer for theme file uploads (logo + icons)
const themeUpload = multer({
  dest: path.join(os.tmpdir(), 'linbo-theme-uploads'),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

async function cleanupTemp(filePath) {
  if (filePath) {
    await fs.unlink(filePath).catch(() => {});
  }
}

const grubThemeConfigSchema = z.object({
  desktopColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  itemColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  selectedItemColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  timeoutColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  timeoutText: z.string().max(200).optional(),
  iconWidth: z.number().int().min(16).max(128).optional(),
  iconHeight: z.number().int().min(16).max(128).optional(),
  itemHeight: z.number().int().min(20).max(120).optional(),
  itemSpacing: z.number().int().min(0).max(60).optional(),
  itemIconSpace: z.number().int().min(0).max(60).optional(),
  logoFile: z.string().max(200).optional(),
  logoWidth: z.number().int().min(50).max(1024).optional(),
  logoHeight: z.number().int().min(50).max(1024).optional(),
});

/**
 * GET /system/grub-theme
 * Get theme status (config + logo info + icon counts)
 */
router.get(
  '/grub-theme',
  authenticateToken,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      const status = await grubThemeService.getThemeStatus();
      res.json({ data: status });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /system/grub-theme
 * Update theme config (colors, sizes, text)
 */
router.put(
  '/grub-theme',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.grub_theme_update'),
  async (req, res, next) => {
    try {
      const parsed = grubThemeConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_CONFIG',
            message: 'Invalid theme configuration',
            details: parsed.error.issues,
          },
        });
      }
      const config = await grubThemeService.updateThemeConfig(parsed.data);
      ws.broadcast('system.grub_theme_updated', { timestamp: new Date() });
      res.json({ data: config });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /system/grub-theme/reset
 * Reset theme config to defaults (icons + logo untouched)
 */
router.post(
  '/grub-theme/reset',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.grub_theme_reset'),
  async (req, res, next) => {
    try {
      const config = await grubThemeService.resetThemeConfig();
      ws.broadcast('system.grub_theme_reset', { timestamp: new Date() });
      res.json({ data: config });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /system/grub-theme/icons
 * List all icons grouped by base name
 */
router.get(
  '/grub-theme/icons',
  authenticateToken,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      const icons = await grubThemeService.listIcons();
      res.json({ data: icons });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /system/grub-theme/icons/:filename
 * Serve a single icon PNG file
 */
router.get(
  '/grub-theme/icons/:filename',
  authenticateToken,
  async (req, res, next) => {
    try {
      const { filename } = req.params;
      const icon = await grubThemeService.getIconFile(filename);
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=300');
      res.set('ETag', `"${icon.size}-${icon.modifiedAt.getTime()}"`);
      const stream = fsSync.createReadStream(icon.path);
      stream.pipe(res);
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'ICON_NOT_FOUND', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_FILENAME', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * POST /system/grub-theme/icons
 * Upload a custom icon (creates 4 variants: base, _start, _syncstart, _newstart)
 */
router.post(
  '/grub-theme/icons',
  authenticateToken,
  requireRole(['admin']),
  themeUpload.single('icon'),
  auditAction('system.grub_theme_icon_upload'),
  async (req, res, next) => {
    const tempPath = req.file?.path;
    try {
      if (!req.file) {
        return res.status(400).json({
          error: { code: 'NO_FILE', message: 'No icon file uploaded' },
        });
      }
      const baseName = req.body.baseName;
      if (!baseName) {
        return res.status(400).json({
          error: { code: 'MISSING_BASENAME', message: 'baseName is required' },
        });
      }
      const result = await grubThemeService.uploadIcon(tempPath, baseName);
      ws.broadcast('system.grub_theme_icon_uploaded', {
        baseName: result.baseName,
        timestamp: new Date(),
      });
      res.status(201).json({ data: result });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_ICON', message: error.message },
        });
      }
      next(error);
    } finally {
      await cleanupTemp(tempPath);
    }
  }
);

/**
 * DELETE /system/grub-theme/icons/:baseName
 * Delete a custom icon (all 4 variants)
 */
router.delete(
  '/grub-theme/icons/:baseName',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.grub_theme_icon_delete'),
  async (req, res, next) => {
    try {
      const { baseName } = req.params;
      const result = await grubThemeService.deleteCustomIcon(baseName);
      ws.broadcast('system.grub_theme_icon_deleted', {
        baseName: result.baseName,
        timestamp: new Date(),
      });
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_OPERATION', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * GET /system/grub-theme/logo
 * Serve the current logo PNG file
 */
router.get(
  '/grub-theme/logo',
  authenticateToken,
  async (req, res, next) => {
    try {
      const logo = await grubThemeService.getLogoFile();
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=300');
      res.set('ETag', `"${logo.size}-${logo.modifiedAt.getTime()}"`);
      const stream = fsSync.createReadStream(logo.path);
      stream.pipe(res);
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'LOGO_NOT_FOUND', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * POST /system/grub-theme/logo
 * Upload a custom logo PNG
 */
router.post(
  '/grub-theme/logo',
  authenticateToken,
  requireRole(['admin']),
  themeUpload.single('logo'),
  auditAction('system.grub_theme_logo_upload'),
  async (req, res, next) => {
    const tempPath = req.file?.path;
    try {
      if (!req.file) {
        return res.status(400).json({
          error: { code: 'NO_FILE', message: 'No logo file uploaded' },
        });
      }
      const result = await grubThemeService.uploadLogo(tempPath);
      ws.broadcast('system.grub_theme_logo_updated', { timestamp: new Date() });
      res.status(201).json({ data: result });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_LOGO', message: error.message },
        });
      }
      next(error);
    } finally {
      await cleanupTemp(tempPath);
    }
  }
);

/**
 * POST /system/grub-theme/logo/reset
 * Reset logo to shipped default
 */
router.post(
  '/grub-theme/logo/reset',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.grub_theme_logo_reset'),
  async (req, res, next) => {
    try {
      const result = await grubThemeService.resetLogo();
      ws.broadcast('system.grub_theme_logo_reset', { timestamp: new Date() });
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'NO_DEFAULT', message: error.message },
        });
      }
      next(error);
    }
  }
);

module.exports = router;
