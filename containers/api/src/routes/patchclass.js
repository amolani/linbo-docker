/**
 * LINBO Docker - Patchclass Routes
 * Windows driver patchclass management endpoints
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { auditAction } = require('../middleware/audit');
const ws = require('../lib/websocket');
const { z } = require('zod');
const patchclassService = require('../services/patchclass.service');
const driverCatalog = require('../lib/driver-catalog');
const sshService = require('../services/ssh.service');

// =============================================================================
// Multer Configuration
// =============================================================================

const upload = multer({
  dest: path.join(os.tmpdir(), 'linbo-uploads'),
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2GB
    files: 1,
  },
});

/**
 * Clean up temp file after use
 */
async function cleanupTemp(filePath) {
  if (filePath) {
    await fs.unlink(filePath).catch(() => {});
  }
}

// =============================================================================
// Zod Schemas
// =============================================================================

const nameSchema = z.object({
  name: z.string().min(1).max(100),
});

const driverSetNameSchema = z.object({
  name: z.string().min(1).max(100),
});

const fileDeleteSchema = z.object({
  path: z.string().min(1).max(1024),
});

const deploySchema = z.object({
  image: z.string().min(1).max(255),
});

// =============================================================================
// Patchclass CRUD
// =============================================================================

/**
 * GET /patchclass
 * List all patchclasses
 */
router.get(
  '/',
  authenticateToken,
  async (req, res, next) => {
    try {
      const patchclasses = await patchclassService.listPatchclasses();
      res.json({ data: patchclasses });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /patchclass
 * Create a new patchclass
 */
router.post(
  '/',
  authenticateToken,
  requireRole(['admin']),
  auditAction('patchclass.create'),
  async (req, res, next) => {
    try {
      const parsed = nameSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'INVALID_NAME', message: 'Invalid patchclass name', details: parsed.error.issues },
        });
      }

      const result = await patchclassService.createPatchclass(parsed.data.name);
      res.status(201).json({ data: result });
    } catch (error) {
      if (error.statusCode === 409) {
        return res.status(409).json({ error: { code: 'DUPLICATE', message: error.message } });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({ error: { code: 'INVALID_NAME', message: error.message } });
      }
      next(error);
    }
  }
);

// =============================================================================
// Hardware Scan (must be registered BEFORE /:name to avoid parameter capture)
// =============================================================================

const scanClientSchema = z.object({
  hostIp: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, 'Invalid IPv4 address'),
});

/**
 * POST /patchclass/scan-client
 * Scan a LINBO client's DMI data and match against patchclass rules
 */
router.post(
  '/scan-client',
  authenticateToken,
  requireRole(['admin']),
  async (req, res, next) => {
    try {
      const parsed = scanClientSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'INVALID_IP', message: 'Invalid host IP address', details: parsed.error.issues },
        });
      }

      const { hostIp } = parsed.data;

      // Read DMI data via SSH
      let sysVendor, productName;
      try {
        const result = await sshService.executeWithTimeout(
          hostIp,
          'cat /sys/class/dmi/id/sys_vendor && echo "---DMI_SEP---" && cat /sys/class/dmi/id/product_name',
          10000
        );
        const parts = result.stdout.split('---DMI_SEP---');
        sysVendor = (parts[0] || '').trim();
        productName = (parts[1] || '').trim();
      } catch (error) {
        if (error.message === 'Command timeout') {
          return res.status(504).json({
            error: { code: 'SSH_TIMEOUT', message: `SSH timeout connecting to ${hostIp}` },
          });
        }
        return res.status(502).json({
          error: { code: 'SSH_FAILED', message: `SSH connection to ${hostIp} failed: ${error.message}` },
        });
      }

      // Load all patchclasses and match DMI against driver maps
      const patchclasses = await patchclassService.listPatchclasses();
      const matches = [];
      const unmatched = [];

      for (const pc of patchclasses) {
        try {
          const detail = await patchclassService.getPatchclassDetail(pc.name);
          const map = detail.driverMap;
          if (!map || !map.models || map.models.length === 0) {
            unmatched.push(pc.name);
            continue;
          }

          let matched = false;
          for (const model of map.models) {
            const vendorMatch = model.match.sys_vendor === sysVendor;
            let productMatch = false;
            if (model.match.product_name !== undefined) {
              productMatch = model.match.product_name === productName;
            } else if (model.match.product_name_contains !== undefined) {
              productMatch = productName.includes(model.match.product_name_contains);
            }

            if (vendorMatch && productMatch) {
              matches.push({
                patchclass: pc.name,
                model: model.name,
                driverSets: model.drivers,
              });
              matched = true;
            }
          }

          if (!matched) {
            unmatched.push(pc.name);
          }
        } catch {
          unmatched.push(pc.name);
        }
      }

      res.json({
        data: {
          host: hostIp,
          dmi: { sys_vendor: sysVendor, product_name: productName },
          matches,
          unmatched,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// Driver Catalog (must be registered BEFORE /:name to avoid parameter capture)
// =============================================================================

/**
 * GET /patchclass/catalog
 * Get driver catalog grouped by category
 */
router.get(
  '/catalog',
  authenticateToken,
  async (req, res) => {
    const catalog = driverCatalog.getCatalogByCategory();
    const categories = driverCatalog.getCategories();
    res.json({ data: { categories, catalog } });
  }
);

/**
 * GET /patchclass/catalog/search?q=intel
 * Search the driver catalog
 */
router.get(
  '/catalog/search',
  authenticateToken,
  async (req, res) => {
    const query = req.query.q || '';
    const results = driverCatalog.searchCatalog(query);
    res.json({ data: results });
  }
);

// =============================================================================
// Patchclass Detail + Driver Map + Sets
// =============================================================================

/**
 * GET /patchclass/:name
 * Get patchclass detail
 */
router.get(
  '/:name',
  authenticateToken,
  async (req, res, next) => {
    try {
      const detail = await patchclassService.getPatchclassDetail(req.params.name);
      res.json({ data: detail });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({ error: { code: 'INVALID_NAME', message: error.message } });
      }
      next(error);
    }
  }
);

/**
 * DELETE /patchclass/:name
 * Delete a patchclass
 */
router.delete(
  '/:name',
  authenticateToken,
  requireRole(['admin']),
  auditAction('patchclass.delete'),
  async (req, res, next) => {
    try {
      const result = await patchclassService.deletePatchclass(req.params.name);
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({ error: { code: 'INVALID_NAME', message: error.message } });
      }
      next(error);
    }
  }
);

// =============================================================================
// Driver Map
// =============================================================================

/**
 * GET /patchclass/:name/driver-map
 * Get driver map
 */
router.get(
  '/:name/driver-map',
  authenticateToken,
  async (req, res, next) => {
    try {
      const map = await patchclassService.getDriverMap(req.params.name);
      res.json({ data: map });
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 400) {
        return res.status(error.statusCode).json({ error: { code: 'ERROR', message: error.message } });
      }
      next(error);
    }
  }
);

/**
 * PUT /patchclass/:name/driver-map
 * Update driver map (regenerates rules)
 */
router.put(
  '/:name/driver-map',
  authenticateToken,
  requireRole(['admin']),
  auditAction('patchclass.driver_map_update'),
  async (req, res, next) => {
    try {
      const result = await patchclassService.updateDriverMap(req.params.name, req.body);
      res.json({ data: result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: { code: 'INVALID_MAP', message: 'Invalid driver map', details: error.issues },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({ error: { code: 'INVALID_MAP', message: error.message } });
      }
      next(error);
    }
  }
);

// =============================================================================
// Device Rules
// =============================================================================

/**
 * POST /patchclass/:name/device-rules
 * Add a device rule (auto-resolves category from catalog if not provided)
 */
router.post(
  '/:name/device-rules',
  authenticateToken,
  requireRole(['admin']),
  auditAction('patchclass.device_rule_add'),
  async (req, res, next) => {
    try {
      // Auto-resolve category from catalog if not explicitly set
      const rule = { ...req.body };
      if (!rule.category && rule.match && rule.match.vendor && rule.match.device) {
        const resolved = driverCatalog.resolveCategory(rule.match.vendor, rule.match.device);
        if (resolved) {
          rule.category = resolved;
        }
      }

      const result = await patchclassService.addDeviceRule(req.params.name, rule);
      res.status(201).json({ data: result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: { code: 'INVALID_RULE', message: 'Invalid device rule', details: error.issues },
        });
      }
      if (error.statusCode === 409) {
        return res.status(409).json({ error: { code: 'DUPLICATE', message: error.message } });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({ error: { code: 'INVALID_RULE', message: error.message } });
      }
      next(error);
    }
  }
);

/**
 * DELETE /patchclass/:name/device-rules/:ruleName
 * Remove a device rule
 */
router.delete(
  '/:name/device-rules/:ruleName',
  authenticateToken,
  requireRole(['admin']),
  auditAction('patchclass.device_rule_remove'),
  async (req, res, next) => {
    try {
      const result = await patchclassService.removeDeviceRule(req.params.name, req.params.ruleName);
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({ error: { code: 'INVALID_NAME', message: error.message } });
      }
      next(error);
    }
  }
);

// =============================================================================
// Driver Sets
// =============================================================================

/**
 * GET /patchclass/:name/driver-sets
 * List driver sets
 */
router.get(
  '/:name/driver-sets',
  authenticateToken,
  async (req, res, next) => {
    try {
      const sets = await patchclassService.listDriverSets(req.params.name);
      res.json({ data: sets });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({ error: { code: 'INVALID_NAME', message: error.message } });
      }
      next(error);
    }
  }
);

/**
 * POST /patchclass/:name/driver-sets
 * Create a driver set
 */
router.post(
  '/:name/driver-sets',
  authenticateToken,
  requireRole(['admin']),
  auditAction('patchclass.driver_set_create'),
  async (req, res, next) => {
    try {
      const parsed = driverSetNameSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'INVALID_NAME', message: 'Invalid driver set name', details: parsed.error.issues },
        });
      }

      const result = await patchclassService.createDriverSet(req.params.name, parsed.data.name);
      res.status(201).json({ data: result });
    } catch (error) {
      if (error.statusCode === 409) {
        return res.status(409).json({ error: { code: 'DUPLICATE', message: error.message } });
      }
      if (error.statusCode === 404) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({ error: { code: 'INVALID_NAME', message: error.message } });
      }
      next(error);
    }
  }
);

/**
 * DELETE /patchclass/:name/driver-sets/:set
 * Delete a driver set
 */
router.delete(
  '/:name/driver-sets/:set',
  authenticateToken,
  requireRole(['admin']),
  auditAction('patchclass.driver_set_delete'),
  async (req, res, next) => {
    try {
      const result = await patchclassService.deleteDriverSet(req.params.name, req.params.set);
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({ error: { code: 'INVALID_NAME', message: error.message } });
      }
      next(error);
    }
  }
);

/**
 * GET /patchclass/:name/driver-sets/:set/files
 * List files in a driver set
 */
router.get(
  '/:name/driver-sets/:set/files',
  authenticateToken,
  async (req, res, next) => {
    try {
      const files = await patchclassService.listDriverSetFiles(req.params.name, req.params.set);
      res.json({ data: files });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({ error: { code: 'INVALID_NAME', message: error.message } });
      }
      next(error);
    }
  }
);

/**
 * POST /patchclass/:name/driver-sets/:set/upload
 * Upload a file to a driver set (multipart/form-data)
 * Field "file" for the file, field "path" for relative path within set
 */
router.post(
  '/:name/driver-sets/:set/upload',
  authenticateToken,
  requireRole(['admin']),
  upload.single('file'),
  auditAction('patchclass.driver_file_upload'),
  async (req, res, next) => {
    const tempPath = req.file?.path;
    try {
      if (!req.file) {
        return res.status(400).json({
          error: { code: 'NO_FILE', message: 'No file uploaded' },
        });
      }

      const relPath = req.body.path || req.file.originalname;
      const buffer = await fs.readFile(tempPath);
      const result = await patchclassService.uploadDriverFile(
        req.params.name, req.params.set, relPath, buffer
      );

      res.status(201).json({ data: result });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({ error: { code: 'INVALID_PATH', message: error.message } });
      }
      next(error);
    } finally {
      await cleanupTemp(tempPath);
    }
  }
);

/**
 * DELETE /patchclass/:name/driver-sets/:set/files
 * Delete a file from a driver set
 */
router.delete(
  '/:name/driver-sets/:set/files',
  authenticateToken,
  requireRole(['admin']),
  auditAction('patchclass.driver_file_delete'),
  async (req, res, next) => {
    try {
      const parsed = fileDeleteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'INVALID_PATH', message: 'Invalid file path', details: parsed.error.issues },
        });
      }

      const result = await patchclassService.deleteDriverFile(
        req.params.name, req.params.set, parsed.data.path
      );
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({ error: { code: 'INVALID_PATH', message: error.message } });
      }
      next(error);
    }
  }
);

/**
 * POST /patchclass/:name/driver-sets/:set/extract
 * Extract an uploaded ZIP into a driver set
 */
router.post(
  '/:name/driver-sets/:set/extract',
  authenticateToken,
  requireRole(['admin']),
  upload.single('file'),
  auditAction('patchclass.driver_zip_extract'),
  async (req, res, next) => {
    const tempPath = req.file?.path;
    try {
      if (!req.file) {
        return res.status(400).json({
          error: { code: 'NO_FILE', message: 'No archive file uploaded' },
        });
      }

      const result = await patchclassService.extractDriverZip(
        req.params.name, req.params.set, tempPath, req.file.originalname
      );
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({ error: { code: 'INVALID_ARCHIVE', message: error.message } });
      }
      if (error.statusCode === 404) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
      }
      next(error);
    } finally {
      await cleanupTemp(tempPath);
    }
  }
);

// =============================================================================
// Postsync Deployment
// =============================================================================

/**
 * GET /patchclass/:name/deployed-postsyncs
 * List deployed postsync scripts for a patchclass
 */
router.get(
  '/:name/deployed-postsyncs',
  authenticateToken,
  async (req, res, next) => {
    try {
      const result = await patchclassService.listDeployedPostsyncs(req.params.name);
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({ error: { code: 'INVALID_NAME', message: error.message } });
      }
      next(error);
    }
  }
);

/**
 * POST /patchclass/:name/deploy-postsync/:image
 * Deploy postsync script for an image
 */
router.post(
  '/:name/deploy-postsync/:image',
  authenticateToken,
  requireRole(['admin']),
  auditAction('patchclass.deploy_postsync'),
  async (req, res, next) => {
    try {
      const result = await patchclassService.deployPostsyncToImage(
        req.params.name, req.params.image
      );
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: error.message } });
      }
      next(error);
    }
  }
);

module.exports = router;
