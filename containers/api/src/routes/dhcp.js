/**
 * LINBO Docker - DHCP Routes
 *
 * Endpoints for DHCP config export (ISC DHCP, dnsmasq),
 * network settings management, and export summary.
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateBody, validateQuery, networkSettingsSchema, dhcpExportQuerySchema } = require('../middleware/validate');
const dhcpService = require('../services/dhcp.service');

// All routes require authentication
router.use(authenticateToken);

// =============================================================================
// Network Settings
// =============================================================================

/**
 * GET /dhcp/network-settings
 * Get current network settings
 */
router.get('/network-settings', async (req, res, next) => {
  try {
    const settings = await dhcpService.getNetworkSettings();
    res.json({ data: settings });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /dhcp/network-settings
 * Update network settings (admin only)
 */
router.put(
  '/network-settings',
  requireRole(['admin']),
  validateBody(networkSettingsSchema),
  async (req, res, next) => {
    try {
      const settings = await dhcpService.saveNetworkSettings(req.body);
      res.json({ data: settings, message: 'Network settings saved' });
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// Summary
// =============================================================================

/**
 * GET /dhcp/summary
 * Get DHCP export summary and stale status
 */
router.get('/summary', async (req, res, next) => {
  try {
    const summary = await dhcpService.getDhcpSummary();
    res.json({ data: summary });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// Export Endpoints
// =============================================================================

/**
 * GET /dhcp/export/isc-dhcp
 * Export ISC DHCP configuration
 */
router.get(
  '/export/isc-dhcp',
  requireRole(['admin', 'operator']),
  validateQuery(dhcpExportQuerySchema),
  async (req, res, next) => {
    try {
      const config = await dhcpService.generateIscDhcpConfig(req.query);

      // Mark as exported
      await dhcpService.markExported();

      if (req.query.format === 'file') {
        res.set('Content-Type', 'text/plain');
        res.set('Content-Disposition', 'attachment; filename="dhcpd-linbo.conf"');
        return res.send(config);
      }

      res.set('Content-Type', 'text/plain');
      res.send(config);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /dhcp/export/dnsmasq
 * Export dnsmasq full DHCP configuration
 */
router.get(
  '/export/dnsmasq',
  requireRole(['admin', 'operator']),
  validateQuery(dhcpExportQuerySchema),
  async (req, res, next) => {
    try {
      const config = await dhcpService.generateDnsmasqConfig({
        ...req.query,
        mode: 'full',
      });

      await dhcpService.markExported();

      if (req.query.format === 'file') {
        res.set('Content-Type', 'text/plain');
        res.set('Content-Disposition', 'attachment; filename="dnsmasq-linbo.conf"');
        return res.send(config);
      }

      res.set('Content-Type', 'text/plain');
      res.send(config);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /dhcp/export/dnsmasq-proxy
 * Export dnsmasq proxy-DHCP configuration
 */
router.get(
  '/export/dnsmasq-proxy',
  requireRole(['admin', 'operator']),
  validateQuery(dhcpExportQuerySchema),
  async (req, res, next) => {
    try {
      const config = await dhcpService.generateDnsmasqConfig({
        ...req.query,
        mode: 'proxy',
      });

      await dhcpService.markExported();

      if (req.query.format === 'file') {
        res.set('Content-Type', 'text/plain');
        res.set('Content-Disposition', 'attachment; filename="dnsmasq-proxy-linbo.conf"');
        return res.send(config);
      }

      res.set('Content-Type', 'text/plain');
      res.send(config);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /dhcp/reload-proxy
 * Trigger reload of the dnsmasq proxy container
 */
router.post(
  '/reload-proxy',
  requireRole(['admin']),
  async (req, res, next) => {
    try {
      // Generate fresh config
      const config = await dhcpService.generateDnsmasqConfig({ mode: 'proxy' });

      // Write to shared volume location
      const fs = require('fs').promises;
      const configPath = '/srv/linbo/dhcp/dnsmasq-proxy.conf';

      // Ensure directory exists
      await fs.mkdir('/srv/linbo/dhcp', { recursive: true });
      await fs.writeFile(configPath, config, 'utf-8');

      await dhcpService.markExported();

      res.json({
        data: {
          configPath,
          message: 'Proxy config written. Run "docker exec linbo-dhcp /reload.sh" to apply.',
          size: config.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
