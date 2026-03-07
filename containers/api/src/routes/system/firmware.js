/**
 * LINBO Docker - Firmware Sub-Router
 * Endpoints: firmware-detect, firmware-entries, firmware-status,
 * firmware-available, firmware-catalog, firmware-entries/bulk
 */
const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { auditAction } = require('../../middleware/audit');
const ws = require('../../lib/websocket');
const { z } = require('zod');
const firmwareService = require('../../services/firmware.service');

const firmwareDetectSchema = z.object({
  hostIp: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, 'Invalid IPv4 address'),
});

const firmwareEntrySchema = z.object({
  entry: z.string().min(1).max(512),
});

const firmwareBulkSchema = z.object({
  entries: z.array(z.string().min(1).max(512)).min(1).max(500),
});

const firmwareSearchSchema = z.object({
  query: z.string().max(256).optional().default(''),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

/** POST /system/firmware-detect -- Auto-detect missing firmware via SSH + dmesg */
router.post(
  '/firmware-detect',
  authenticateToken,
  requireRole(['admin']),
  async (req, res, next) => {
    try {
      const parsed = firmwareDetectSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_IP',
            message: 'Invalid host IP address',
            details: parsed.error.issues,
          },
        });
      }

      const result = await firmwareService.detectFirmwareFromHost(parsed.data.hostIp);
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 502) {
        return res.status(502).json({
          error: { code: 'SSH_FAILED', message: error.message },
        });
      }
      if (error.statusCode === 504) {
        return res.status(504).json({
          error: { code: 'SSH_TIMEOUT', message: error.message },
        });
      }
      next(error);
    }
  }
);

/** GET /system/firmware-entries -- List configured firmware entries with validation status */
router.get(
  '/firmware-entries',
  authenticateToken,
  async (req, res, next) => {
    try {
      const entries = await firmwareService.getFirmwareEntries();
      res.json({ data: entries });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /system/firmware-status
 * Combined firmware status (entries + stats + rebuild state)
 */
router.get(
  '/firmware-status',
  authenticateToken,
  async (req, res, next) => {
    try {
      const status = await firmwareService.getFirmwareStatus();
      res.json({ data: status });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /system/firmware-entries
 * Add a firmware entry to the config
 */
router.post(
  '/firmware-entries',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.firmware_add'),
  async (req, res, next) => {
    try {
      const parsed = firmwareEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_ENTRY',
            message: 'Invalid firmware entry',
            details: parsed.error.issues,
          },
        });
      }

      const result = await firmwareService.addFirmwareEntry(parsed.data.entry);

      ws.broadcast('system.firmware_changed', {
        action: 'added',
        entry: result.entry,
        timestamp: new Date(),
      });

      res.status(201).json({ data: result });
    } catch (error) {
      if (error.statusCode === 409) {
        return res.status(409).json({
          error: { code: 'DUPLICATE_ENTRY', message: error.message },
        });
      }
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'FIRMWARE_NOT_FOUND', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_ENTRY', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * POST /system/firmware-entries/remove
 * Remove a firmware entry (main endpoint -- body-based to avoid URL encoding issues)
 */
router.post(
  '/firmware-entries/remove',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.firmware_remove'),
  async (req, res, next) => {
    try {
      const parsed = firmwareEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_ENTRY',
            message: 'Invalid firmware entry',
            details: parsed.error.issues,
          },
        });
      }

      const result = await firmwareService.removeFirmwareEntry(parsed.data.entry);

      ws.broadcast('system.firmware_changed', {
        action: 'removed',
        entry: result.removed,
        timestamp: new Date(),
      });

      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'ENTRY_NOT_FOUND', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_ENTRY', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * DELETE /system/firmware-entries
 * Remove a firmware entry (REST alias -- same handler)
 */
router.delete(
  '/firmware-entries',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.firmware_remove'),
  async (req, res, next) => {
    try {
      const parsed = firmwareEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_ENTRY',
            message: 'Invalid firmware entry',
            details: parsed.error.issues,
          },
        });
      }

      const result = await firmwareService.removeFirmwareEntry(parsed.data.entry);

      ws.broadcast('system.firmware_changed', {
        action: 'removed',
        entry: result.removed,
        timestamp: new Date(),
      });

      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'ENTRY_NOT_FOUND', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_ENTRY', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * GET /system/firmware-available
 * Search available firmware on the host filesystem
 */
router.get(
  '/firmware-available',
  authenticateToken,
  async (req, res, next) => {
    try {
      const parsed = firmwareSearchSchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_QUERY',
            message: 'Invalid search parameters',
            details: parsed.error.issues,
          },
        });
      }

      const results = await firmwareService.searchAvailableFirmware(
        parsed.data.query,
        parsed.data.limit
      );
      res.json({ data: results });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /system/firmware-catalog
 * Get firmware catalog with vendor categories and availability
 * Query: ?expand=true to include expandedFiles for prefix entries
 */
router.get(
  '/firmware-catalog',
  authenticateToken,
  async (req, res, next) => {
    try {
      const expand = req.query.expand === 'true';
      const catalog = await firmwareService.getFirmwareCatalog(expand);
      res.json({ data: catalog });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /system/firmware-entries/bulk
 * Add multiple firmware entries in one atomic write
 */
router.post(
  '/firmware-entries/bulk',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.firmware_bulk_add'),
  async (req, res, next) => {
    try {
      const parsed = firmwareBulkSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_ENTRIES',
            message: 'Invalid bulk entries',
            details: parsed.error.issues,
          },
        });
      }

      const result = await firmwareService.addBulkFirmwareEntries(parsed.data.entries);

      if (result.added.length > 0) {
        ws.broadcast('system.firmware_changed', {
          action: 'bulk_added',
          count: result.added.length,
          timestamp: new Date(),
        });
      }

      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_ENTRIES', message: error.message },
        });
      }
      next(error);
    }
  }
);

module.exports = router;
