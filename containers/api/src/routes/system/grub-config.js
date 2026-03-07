/**
 * LINBO Docker - GRUB Config Sub-Router
 * 4 endpoints: regenerate-grub-configs, grub-configs, cleanup-grub-configs, migrate-grub-configs
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { auditAction } = require('../../middleware/audit');
const ws = require('../../lib/websocket');
const grubService = require('../../services/grub.service');

/**
 * POST /system/regenerate-grub-configs
 * Regenerate all GRUB configs for all groups and hosts
 */
router.post(
  '/regenerate-grub-configs',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.regenerate_grub_configs'),
  async (req, res, next) => {
    try {
      const result = await grubService.regenerateAllGrubConfigs();

      ws.broadcast('system.grub_configs_regenerated', {
        configs: result.configs?.length || 0,
        hosts: result.hosts,
        timestamp: new Date(),
      });

      res.json({
        data: {
          message: `Generated ${result.configs?.length || 0} config files and ${result.hosts} host symlinks`,
          ...result,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /system/grub-configs
 * List all GRUB configs
 */
router.get(
  '/grub-configs',
  authenticateToken,
  async (req, res, next) => {
    try {
      const configs = await grubService.listGrubConfigs();
      res.json({ data: configs });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /system/cleanup-grub-configs
 * Remove orphaned GRUB configs
 */
router.post(
  '/cleanup-grub-configs',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.cleanup_grub_configs'),
  async (req, res, next) => {
    try {
      const result = await grubService.cleanupOrphanedConfigs();

      res.json({
        data: {
          message: `Removed ${result.removedConfigs?.length || 0} config files and ${result.removedHosts?.length || 0} host configs`,
          ...result,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /system/migrate-grub-configs
 * Migrate existing host config files to symlinks
 * This converts regular files in hostcfg/ to symlinks pointing to config files
 */
router.post(
  '/migrate-grub-configs',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.migrate_grub_configs'),
  async (req, res, next) => {
    try {
      const result = await grubService.migrateHostConfigsToSymlinks();

      ws.broadcast('system.grub_configs_migrated', {
        migrated: result.migrated,
        alreadySymlinks: result.alreadySymlinks,
        errors: result.errors.length,
        timestamp: new Date(),
      });

      res.json({
        data: {
          message: `Migration complete: ${result.migrated} migrated, ${result.alreadySymlinks} already symlinks`,
          ...result,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
