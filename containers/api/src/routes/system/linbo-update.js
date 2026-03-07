/**
 * LINBO Docker - LINBO Update Sub-Router
 * 4 endpoints: linbo-version, linbo-update POST, linbo-update/status, linbo-update/cancel
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { auditAction } = require('../../middleware/audit');
const linboUpdateService = require('../../services/linbo-update.service');

/**
 * GET /system/linbo-version
 * Check installed and available LINBO version
 */
router.get(
  '/linbo-version',
  authenticateToken,
  async (req, res, next) => {
    try {
      const info = await linboUpdateService.checkVersion();
      res.json({ data: info });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /system/linbo-update
 * Start LINBO update (downloads, extracts, provisions, rebuilds)
 */
router.post(
  '/linbo-update',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.linbo_update'),
  async (req, res, next) => {
    try {
      // Start update in background
      linboUpdateService.startUpdate().catch((err) => {
        if (err.message !== 'Update cancelled') {
          console.error('[LinboUpdate] Update failed:', err.message);
        }
      });

      res.json({ data: { started: true } });
    } catch (error) {
      if (error.statusCode === 409) {
        return res.status(409).json({
          error: { code: 'UPDATE_IN_PROGRESS', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'NO_UPDATE', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * GET /system/linbo-update/status
 * Get current update progress
 */
router.get(
  '/linbo-update/status',
  authenticateToken,
  async (req, res, next) => {
    try {
      const status = await linboUpdateService.getStatus();
      res.json({ data: status });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /system/linbo-update/cancel
 * Cancel a running update
 */
router.post(
  '/linbo-update/cancel',
  authenticateToken,
  requireRole(['admin']),
  async (req, res) => {
    linboUpdateService.cancelUpdate();
    res.json({ data: { cancelled: true } });
  }
);

module.exports = router;
