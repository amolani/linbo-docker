/**
 * LINBO Docker - Kernel Sub-Router
 * 5 endpoints: kernel-variants, kernel-active, kernel-status, kernel-switch, kernel-repair
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { auditAction } = require('../../middleware/audit');
const ws = require('../../lib/websocket');
const { z } = require('zod');
const kernelService = require('../../services/kernel.service');

const kernelSwitchSchema = z.object({
  variant: z.enum(['stable', 'longterm', 'legacy']),
});

const kernelRepairSchema = z.object({
  rebuild: z.boolean().optional().default(false),
});

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

module.exports = router;
