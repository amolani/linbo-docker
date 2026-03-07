/**
 * LINBO Docker - Worker Sub-Router
 * 3 endpoints: worker-status, worker/pause, worker/resume
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { auditAction } = require('../../middleware/audit');
const operationWorker = require('../../workers/operation.worker');

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
