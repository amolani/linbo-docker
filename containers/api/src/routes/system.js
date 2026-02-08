/**
 * LINBO Docker - System Routes
 * System administration endpoints
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { auditAction } = require('../middleware/audit');
const ws = require('../lib/websocket');
const { z } = require('zod');
const linbofsService = require('../services/linbofs.service');
const grubService = require('../services/grub.service');
const kernelService = require('../services/kernel.service');
const operationWorker = require('../workers/operation.worker');

const kernelSwitchSchema = z.object({
  variant: z.enum(['stable', 'longterm', 'legacy']),
});

const kernelRepairSchema = z.object({
  rebuild: z.boolean().optional().default(false),
});

/**
 * POST /system/update-linbofs
 * Update linbofs64 with current SSH keys and password hash
 */
router.post(
  '/update-linbofs',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.update_linbofs'),
  async (req, res, next) => {
    try {
      // Broadcast start event
      ws.broadcast('system.linbofs_update_started', {
        timestamp: new Date(),
      });

      const result = await linbofsService.updateLinbofs();

      // Broadcast completion event
      ws.broadcast('system.linbofs_updated', {
        success: result.success,
        duration: result.duration,
        timestamp: new Date(),
      });

      if (result.success) {
        res.json({
          data: {
            success: true,
            message: 'linbofs64 updated successfully',
            output: result.output,
            duration: result.duration,
          },
        });
      } else {
        res.status(500).json({
          error: {
            code: 'UPDATE_LINBOFS_FAILED',
            message: 'Failed to update linbofs64',
            details: result.errors,
            output: result.output,
          },
        });
      }
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /system/linbofs-status
 * Check if linbofs64 is correctly configured with keys
 */
router.get(
  '/linbofs-status',
  authenticateToken,
  async (req, res, next) => {
    try {
      const [fileInfo, verification, keyFiles] = await Promise.all([
        linbofsService.getLinbofsInfo(),
        linbofsService.verifyLinbofs(),
        linbofsService.checkKeyFiles(),
      ]);

      // Determine overall status
      let status = 'unknown';
      let message = '';

      if (!fileInfo.exists) {
        status = 'missing';
        message = 'linbofs64 file not found';
      } else if (!verification.valid) {
        status = 'invalid';
        message = 'linbofs64 file is invalid or corrupted';
      } else if (!verification.hasPasswordHash) {
        status = 'not_configured';
        message = 'linbofs64 missing password hash - run update-linbofs';
      } else if (!verification.hasAuthorizedKeys && !verification.hasDropbearKey) {
        status = 'partial';
        message = 'linbofs64 missing SSH keys - run update-linbofs';
      } else {
        status = 'ready';
        message = 'linbofs64 is properly configured';
      }

      res.json({
        data: {
          status,
          message,
          file: fileInfo,
          contents: verification,
          availableKeys: keyFiles,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /system/linbofs-info
 * Get detailed linbofs64 file information
 */
router.get(
  '/linbofs-info',
  authenticateToken,
  async (req, res, next) => {
    try {
      const info = await linbofsService.getLinbofsInfo();
      res.json({ data: info });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /system/key-status
 * Check available SSH/Dropbear keys
 */
router.get(
  '/key-status',
  authenticateToken,
  async (req, res, next) => {
    try {
      const keyFiles = await linbofsService.checkKeyFiles();

      const status = {
        hasDropbearKeys: keyFiles.dropbearKeys.length > 0,
        hasSshKeys: keyFiles.sshKeys.length > 0,
        hasPublicKeys: keyFiles.publicKeys.length > 0,
        ...keyFiles,
      };

      res.json({ data: status });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /system/initialize-keys
 * Generate SSH and Dropbear keys if they don't exist
 */
router.post(
  '/initialize-keys',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.initialize_keys'),
  async (req, res, next) => {
    try {
      const result = await linbofsService.initializeKeys();

      ws.broadcast('system.keys_initialized', {
        created: result.created,
        timestamp: new Date(),
      });

      res.json({
        data: {
          message: result.created.length > 0
            ? `Created ${result.created.length} key(s)`
            : 'All keys already exist',
          created: result.created,
          existing: result.existing,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /system/generate-ssh-key
 * Generate a specific SSH key
 */
router.post(
  '/generate-ssh-key',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.generate_ssh_key'),
  async (req, res, next) => {
    try {
      const { type = 'ed25519' } = req.body;

      if (!['rsa', 'ed25519', 'ecdsa'].includes(type)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_KEY_TYPE',
            message: 'Key type must be one of: rsa, ed25519, ecdsa',
          },
        });
      }

      const result = await linbofsService.generateSshKeyPair(type);

      res.json({
        data: {
          message: result.created ? 'Key generated' : 'Key already exists',
          ...result,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /system/generate-dropbear-key
 * Generate a specific Dropbear key
 */
router.post(
  '/generate-dropbear-key',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.generate_dropbear_key'),
  async (req, res, next) => {
    try {
      const { type = 'ed25519' } = req.body;

      if (!['rsa', 'ed25519', 'ecdsa'].includes(type)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_KEY_TYPE',
            message: 'Key type must be one of: rsa, ed25519, ecdsa',
          },
        });
      }

      const result = await linbofsService.generateDropbearKey(type);

      res.json({
        data: {
          message: result.created ? 'Key generated' : 'Key already exists',
          ...result,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// Kernel Variant Management
// =============================================================================

/**
 * GET /system/kernel-variants
 * List available kernel variants with versions and sizes
 */
router.get(
  '/kernel-variants',
  authenticateToken,
  async (req, res, next) => {
    try {
      const variants = await kernelService.listKernelVariants();
      res.json({ data: variants });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /system/kernel-active
 * Get currently active kernel variant
 */
router.get(
  '/kernel-active',
  authenticateToken,
  async (req, res, next) => {
    try {
      const active = await kernelService.getActiveKernel();
      res.json({ data: active });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /system/kernel-status
 * Combined status: variants + active + rebuild state
 */
router.get(
  '/kernel-status',
  authenticateToken,
  async (req, res, next) => {
    try {
      const status = await kernelService.getKernelStatus();
      res.json({ data: status });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /system/kernel-switch
 * Switch kernel variant (triggers linbofs rebuild)
 */
router.post(
  '/kernel-switch',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.kernel_switch'),
  async (req, res, next) => {
    try {
      const parsed = kernelSwitchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_VARIANT',
            message: 'Invalid kernel variant',
            details: parsed.error.issues,
          },
        });
      }

      const { variant } = parsed.data;

      ws.broadcast('system.kernel_switch_started', {
        variant,
        timestamp: new Date(),
      });

      const result = await kernelService.switchKernel(variant);

      // Monitor rebuild completion for WS events (best-effort)
      (async () => {
        const startTime = Date.now();
        const maxWait = 300000; // 5 minutes
        while (Date.now() - startTime < maxWait) {
          await new Promise(r => setTimeout(r, 2000));
          const state = await kernelService.readKernelState();
          if (state.rebuildStatus !== 'running') {
            if (state.rebuildStatus === 'completed') {
              ws.broadcast('system.kernel_switched', {
                variant,
                jobId: result.jobId,
                timestamp: new Date(),
              });
            } else {
              ws.broadcast('system.kernel_switch_failed', {
                variant,
                jobId: result.jobId,
                error: state.lastError,
                timestamp: new Date(),
              });
            }
            break;
          }
        }
      })().catch(() => {});

      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 409) {
        return res.status(409).json({
          error: {
            code: 'REBUILD_IN_PROGRESS',
            message: error.message,
          },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: {
            code: 'INVALID_VARIANT',
            message: error.message,
          },
        });
      }
      next(error);
    }
  }
);

/**
 * POST /system/kernel-repair
 * Reset custom_kernel to "stable" (heals broken config)
 */
router.post(
  '/kernel-repair',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.kernel_repair'),
  async (req, res, next) => {
    try {
      const parsed = kernelRepairSchema.safeParse(req.body || {});
      const rebuild = parsed.success ? parsed.data.rebuild : false;

      const repairResult = await kernelService.repairConfig();

      if (rebuild) {
        // Trigger rebuild after repair
        const switchResult = await kernelService.switchKernel('stable');
        return res.json({
          data: {
            message: 'Config repaired and rebuild started',
            variant: repairResult.variant,
            jobId: switchResult.jobId,
          },
        });
      }

      res.json({
        data: {
          message: 'Config repaired (no rebuild)',
          variant: repairResult.variant,
        },
      });
    } catch (error) {
      if (error.statusCode === 409) {
        return res.status(409).json({
          error: {
            code: 'REBUILD_IN_PROGRESS',
            message: error.message,
          },
        });
      }
      next(error);
    }
  }
);

// =============================================================================
// GRUB Configuration Management
// =============================================================================

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

// =============================================================================
// Operation Worker Management
// =============================================================================

/**
 * GET /system/worker-status
 * Get operation worker status
 */
router.get(
  '/worker-status',
  authenticateToken,
  async (req, res, next) => {
    try {
      const status = operationWorker.getStatus();
      res.json({ data: status });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /system/worker/pause
 * Pause the operation worker
 */
router.post(
  '/worker/pause',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.worker_pause'),
  async (req, res, next) => {
    try {
      operationWorker.pauseWorker();
      res.json({
        data: {
          message: 'Operation worker paused',
          status: operationWorker.getStatus(),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /system/worker/resume
 * Resume the operation worker
 */
router.post(
  '/worker/resume',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.worker_resume'),
  async (req, res, next) => {
    try {
      operationWorker.resumeWorker();
      res.json({
        data: {
          message: 'Operation worker resumed',
          status: operationWorker.getStatus(),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
