/**
 * LINBO Docker - Hooks Sub-Router
 * GET /system/hooks - list installed hooks with observability data
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const hookService = require('../../services/hook.service');

/**
 * GET /system/hooks
 * Returns all installed hooks with type, executable status, and last exit codes
 */
router.get('/hooks', authenticateToken, async (req, res, next) => {
  try {
    const hooks = await hookService.getHooks();
    res.json({ data: hooks });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
