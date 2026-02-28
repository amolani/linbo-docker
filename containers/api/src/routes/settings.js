/**
 * LINBO Docker - Settings Routes
 *
 * GET    /settings              — All settings (secrets masked)
 * PUT    /settings/:key         — Update setting (admin)
 * DELETE /settings/:key         — Reset setting to default (admin)
 * POST   /settings/test-connection — Test authority API connection (admin)
 */

const express = require('express');
const router = express.Router();
const settings = require('../services/settings.service');
const auth = require('../middleware/auth');

const authenticate = auth.authenticateToken;
const requireAdmin = auth.requireRole(['admin']);

// Auth on all routes
router.use(authenticate);

/**
 * GET / — All settings with masked secrets
 */
router.get('/', async (req, res, next) => {
  try {
    const data = await settings.getAll();
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /test-connection — Test authority API connectivity
 * Optional body: { url, key } to test before saving
 */
router.post('/test-connection', requireAdmin, async (req, res, next) => {
  try {
    const url = req.body.url || await settings.get('lmn_api_url');
    const key = req.body.key || await settings.get('lmn_api_key');

    const start = Date.now();
    let reachable = false;
    let healthy = false;
    let version = null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`${url}/health`, {
        headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      reachable = true;
      if (response.ok) {
        const data = await response.json();
        healthy = data.status === 'ok';
        version = data.version || null;
      }
    } catch {
      // reachable stays false
    }

    const latency = Date.now() - start;
    res.json({ data: { reachable, healthy, version, latency } });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /:key — Update a setting
 */
router.put('/:key', requireAdmin, async (req, res, next) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined || value === null) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'value is required' },
      });
    }

    await settings.set(key, value);

    // Return the updated setting (via getAll to get proper masking)
    const all = await settings.getAll();
    // For admin_password, the stored key is admin_password_hash
    const lookupKey = key === 'admin_password' ? 'admin_password_hash' : key;
    const updated = all.find(s => s.key === lookupKey);

    res.json({ data: updated || { key: lookupKey, source: 'redis' } });
  } catch (err) {
    if (err.message.startsWith('Unknown setting') || err.message.startsWith('Cannot set') || err.message.startsWith('Invalid value') || err.message.startsWith('Setting')) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: err.message },
      });
    }
    next(err);
  }
});

/**
 * DELETE /:key — Reset setting to default
 */
router.delete('/:key', requireAdmin, async (req, res, next) => {
  try {
    const { key } = req.params;
    await settings.reset(key);
    res.json({ data: { success: true, key } });
  } catch (err) {
    if (err.message.startsWith('Unknown setting')) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: err.message },
      });
    }
    next(err);
  }
});

module.exports = router;
