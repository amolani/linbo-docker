/**
 * LINBO Docker - WLAN Sub-Router
 * 3 endpoints: wlan-config GET/PUT/DELETE
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { auditAction } = require('../../middleware/audit');
const { z } = require('zod');
const firmwareService = require('../../services/firmware.service');

const wlanConfigSchema = z.object({
  ssid: z.string().min(1).max(32),
  keyMgmt: z.enum(['WPA-PSK', 'NONE']),
  psk: z.string().max(128).optional(),
  scanSsid: z.boolean().optional(),
});

/**
 * GET /system/wlan-config
 * Get WLAN status (never returns PSK value)
 */
router.get(
  '/wlan-config',
  authenticateToken,
  async (req, res, next) => {
    try {
      const config = await firmwareService.getWlanConfig();
      res.json({ data: config });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /system/wlan-config
 * Set WLAN configuration (PSK redacted in audit)
 */
router.put(
  '/wlan-config',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.wlan_update', {
    getChanges: (req) => ({
      ssid: req.body.ssid,
      keyMgmt: req.body.keyMgmt,
      psk: req.body.psk ? '[REDACTED]' : undefined,
    }),
  }),
  async (req, res, next) => {
    try {
      const parsed = wlanConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_CONFIG',
            message: 'Invalid WLAN configuration',
            details: parsed.error.issues,
          },
        });
      }

      await firmwareService.setWlanConfig(parsed.data);
      const config = await firmwareService.getWlanConfig();
      res.json({ data: config });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_CONFIG', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * DELETE /system/wlan-config
 * Disable WLAN (delete wpa_supplicant.conf)
 */
router.delete(
  '/wlan-config',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.wlan_delete'),
  async (req, res, next) => {
    try {
      await firmwareService.disableWlan();
      res.json({ data: { enabled: false } });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
