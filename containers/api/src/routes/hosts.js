/**
 * LINBO Docker - Hosts Routes
 * CRUD operations for host management
 */

const express = require('express');
const router = express.Router();
const { prisma } = require('../lib/prisma');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  validateBody,
  validateQuery,
  createHostSchema,
  updateHostSchema,
  hostQuerySchema,
} = require('../middleware/validate');
const { auditAction } = require('../middleware/audit');
const redis = require('../lib/redis');
const grubService = require('../services/grub.service');
const configService = require('../services/config.service');
const provisioningService = require('../services/provisioning.service');

// =============================================================================
// Device Import/Export Routes (Phase 7) - MUST be before /:id route!
// =============================================================================

const deviceImportService = require('../services/deviceImport.service');

/**
 * POST /hosts/import
 * Import hosts from CSV (linuxmuster devices.csv format)
 */
router.post(
  '/import',
  authenticateToken,
  requireRole(['admin']),
  auditAction('hosts.import'),
  async (req, res, next) => {
    try {
      const { csv, options = {} } = req.body;

      if (!csv) {
        return res.status(400).json({
          error: {
            code: 'MISSING_CSV',
            message: 'CSV content is required',
          },
        });
      }

      const result = await deviceImportService.importFromCsv(csv, options);

      // Invalidate cache after successful import
      if (result.success && !options.dryRun) {
        await redis.delPattern('hosts:*');

        // Queue provisioning jobs for imported hosts
        if (provisioningService.isProvisioningEnabled() && result.imported) {
          for (const imported of result.imported) {
            try {
              await provisioningService.createProvisionJob(
                {
                  hostname: imported.hostname,
                  macAddress: imported.macAddress,
                  ipAddress: imported.ipAddress,
                  csvCol0: imported.room || '',
                  configName: imported.config || '',
                  hostId: imported.id,
                },
                imported.action === 'updated' ? 'update' : 'create'
              );
            } catch (err) {
              console.error(`[Hosts] Provisioning queue failed for ${imported.hostname}:`, err.message);
            }
          }
        }
      }

      const statusCode = result.success ? 200 : 400;
      res.status(statusCode).json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /hosts/import/validate
 * Validate CSV without importing
 */
router.post(
  '/import/validate',
  authenticateToken,
  requireRole(['admin', 'operator']),
  async (req, res, next) => {
    try {
      const { csv, options = {} } = req.body;

      if (!csv) {
        return res.status(400).json({
          error: {
            code: 'MISSING_CSV',
            message: 'CSV content is required',
          },
        });
      }

      // Dry-run import
      const result = await deviceImportService.importFromCsv(csv, {
        ...options,
        dryRun: true,
      });

      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /hosts/export
 * Export all hosts as CSV
 */
router.get(
  '/export',
  authenticateToken,
  requireRole(['admin', 'operator']),
  async (req, res, next) => {
    try {
      const csv = await deviceImportService.exportToCsv();

      // Set headers for CSV download
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="devices_${new Date().toISOString().split('T')[0]}.csv"`
      );

      res.send(csv);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /hosts/sync-filesystem
 * Synchronize database with filesystem (symlinks, GRUB configs)
 */
router.post(
  '/sync-filesystem',
  authenticateToken,
  requireRole(['admin']),
  auditAction('hosts.sync_filesystem'),
  async (req, res, next) => {
    try {
      const result = await deviceImportService.syncFilesystem();

      res.json({
        data: {
          message: 'Filesystem synchronized',
          ...result,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// Standard Host Routes
// =============================================================================

/**
 * GET /hosts
 * List hosts with pagination and filters
 */
router.get(
  '/',
  authenticateToken,
  validateQuery(hostQuerySchema),
  async (req, res, next) => {
    try {
      const { page, limit, sortBy, sortOrder, roomId, configId, status, search } = req.query;

      // Build where clause
      const where = {};
      if (roomId) where.roomId = roomId;
      if (configId) where.configId = configId;
      if (status) where.status = status;
      if (search) {
        where.OR = [
          { hostname: { contains: search, mode: 'insensitive' } },
          { macAddress: { contains: search, mode: 'insensitive' } },
          { ipAddress: { contains: search } },
        ];
      }

      // Build orderBy
      const orderBy = sortBy ? { [sortBy]: sortOrder } : { hostname: 'asc' };

      // Execute query with count
      const [hosts, total] = await Promise.all([
        prisma.host.findMany({
          where,
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
          include: {
            room: { select: { id: true, name: true } },
            config: { select: { id: true, name: true } },
          },
        }),
        prisma.host.count({ where }),
      ]);

      res.json({
        data: hosts,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /hosts/:id
 * Get single host by ID
 */
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const host = await prisma.host.findUnique({
      where: { id: req.params.id },
      include: {
        room: true,
        config: {
          include: {
            partitions: { orderBy: { position: 'asc' } },
            osEntries: { orderBy: { position: 'asc' } },
          },
        },
        sessions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!host) {
      return res.status(404).json({
        error: {
          code: 'HOST_NOT_FOUND',
          message: 'Host not found',
        },
      });
    }

    res.json({ data: host });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /hosts/by-name/:hostname
 * Lookup host by hostname
 */
router.get('/by-name/:hostname', authenticateToken, async (req, res, next) => {
  try {
    const host = await prisma.host.findUnique({
      where: { hostname: req.params.hostname },
      include: {
        room: { select: { id: true, name: true } },
        config: { select: { id: true, name: true } },
      },
    });

    if (!host) {
      return res.status(404).json({
        error: {
          code: 'HOST_NOT_FOUND',
          message: 'Host not found',
        },
      });
    }

    res.json({ data: host });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /hosts/by-mac/:mac
 * Lookup host by MAC address
 */
router.get('/by-mac/:mac', authenticateToken, async (req, res, next) => {
  try {
    // Normalize MAC address (handle both : and - separators)
    const mac = req.params.mac.replace(/-/g, ':').toLowerCase();

    const host = await prisma.host.findFirst({
      where: {
        macAddress: { equals: mac, mode: 'insensitive' },
      },
      include: {
        room: { select: { id: true, name: true } },
        config: { select: { id: true, name: true } },
      },
    });

    if (!host) {
      return res.status(404).json({
        error: {
          code: 'HOST_NOT_FOUND',
          message: 'Host not found',
        },
      });
    }

    res.json({ data: host });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /hosts
 * Create new host
 */
router.post(
  '/',
  authenticateToken,
  requireRole(['admin', 'operator']),
  validateBody(createHostSchema),
  auditAction('host.create', {
    getTargetId: (req, data) => data?.data?.id,
    getTargetName: (req) => req.body.hostname,
  }),
  async (req, res, next) => {
    try {
      // Normalize MAC address
      const macAddress = req.body.macAddress.replace(/-/g, ':').toLowerCase();

      const host = await prisma.host.create({
        data: {
          ...req.body,
          macAddress,
        },
        include: {
          room: { select: { id: true, name: true } },
          config: { select: { id: true, name: true } },
        },
      });

      // Invalidate cache
      await redis.delPattern('hosts:*');

      // Generate GRUB config and start.conf symlink for new host
      if (host.config) {
        try {
          await grubService.generateHostGrubConfig(host.hostname, host.config.name);
        } catch (error) {
          console.error('[Hosts] Failed to generate GRUB config:', error.message);
        }
        try {
          await configService.createHostSymlinks(host.config.id);
        } catch (error) {
          console.error('[Hosts] Failed to create start.conf symlinks:', error.message);
        }
      }

      // Queue provisioning job on DC
      if (provisioningService.isProvisioningEnabled()) {
        try {
          const provResult = await provisioningService.createProvisionJob(
            {
              hostname: host.hostname,
              macAddress: host.macAddress,
              ipAddress: host.ipAddress,
              csvCol0: host.room?.name,
              configName: host.config?.name,
              hostId: host.id,
            },
            'create'
          );
          if (provResult.queued) {
            await provisioningService.syncHostProvisionStatus(host.id, provResult.operation.id, 'pending');
          }
        } catch (err) {
          console.error('[Hosts] Provisioning queue failed:', err.message);
        }
      }

      res.status(201).json({ data: host });
    } catch (error) {
      if (error.code === 'P2002') {
        const field = error.meta?.target?.[0];
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_ENTRY',
            message: `A host with this ${field} already exists`,
          },
        });
      }
      next(error);
    }
  }
);

/**
 * PATCH /hosts/:id
 * Update host
 */
router.patch(
  '/:id',
  authenticateToken,
  requireRole(['admin', 'operator']),
  validateBody(updateHostSchema),
  auditAction('host.update', {
    getTargetName: (req, data) => data?.data?.hostname,
  }),
  async (req, res, next) => {
    try {
      const data = { ...req.body };

      // Normalize MAC if provided
      if (data.macAddress) {
        data.macAddress = data.macAddress.replace(/-/g, ':').toLowerCase();
      }

      // Fetch old host state for provisioning (hostname rename detection)
      let oldHost = null;
      if (provisioningService.isProvisioningEnabled()) {
        oldHost = await prisma.host.findUnique({
          where: { id: req.params.id },
          select: { hostname: true, macAddress: true, ipAddress: true },
        });
      }

      const host = await prisma.host.update({
        where: { id: req.params.id },
        data,
        include: {
          room: { select: { id: true, name: true } },
          config: { select: { id: true, name: true } },
        },
      });

      // Invalidate cache
      await redis.delPattern('hosts:*');

      // Regenerate GRUB config and start.conf symlinks for updated host
      if (host.config) {
        try {
          await grubService.generateHostGrubConfig(host.hostname, host.config.name);
        } catch (error) {
          console.error('[Hosts] Failed to regenerate GRUB config:', error.message);
        }
        try {
          await configService.createHostSymlinks(host.config.id);
        } catch (error) {
          console.error('[Hosts] Failed to update start.conf symlinks:', error.message);
        }
      }

      // Queue provisioning update job on DC
      if (provisioningService.isProvisioningEnabled()) {
        try {
          const extraOptions = {};
          if (oldHost && oldHost.hostname !== host.hostname) {
            extraOptions.oldHostname = oldHost.hostname;
          }
          const provResult = await provisioningService.createProvisionJob(
            {
              hostname: host.hostname,
              macAddress: host.macAddress,
              ipAddress: host.ipAddress,
              csvCol0: host.room?.name,
              configName: host.config?.name,
              hostId: host.id,
            },
            'update',
            extraOptions
          );
          if (provResult.queued) {
            await provisioningService.syncHostProvisionStatus(host.id, provResult.operation.id, 'pending');
          }
        } catch (err) {
          console.error('[Hosts] Provisioning queue failed:', err.message);
        }
      }

      res.json({ data: host });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: {
            code: 'HOST_NOT_FOUND',
            message: 'Host not found',
          },
        });
      }
      if (error.code === 'P2002') {
        const field = error.meta?.target?.[0];
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_ENTRY',
            message: `A host with this ${field} already exists`,
          },
        });
      }
      next(error);
    }
  }
);

/**
 * DELETE /hosts/:id
 * Delete host
 */
router.delete(
  '/:id',
  authenticateToken,
  requireRole(['admin']),
  auditAction('host.delete'),
  async (req, res, next) => {
    try {
      // Get host info before deletion for GRUB cleanup + provisioning snapshot
      const host = await prisma.host.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          hostname: true,
          macAddress: true,
          ipAddress: true,
          room: { select: { name: true } },
          config: { select: { name: true } },
        },
      });

      await prisma.host.delete({
        where: { id: req.params.id },
      });

      // Invalidate cache
      await redis.delPattern('hosts:*');

      // Delete GRUB config for deleted host
      if (host) {
        try {
          await grubService.deleteHostGrubConfig(host.hostname);
        } catch (error) {
          console.error('[Hosts] Failed to delete GRUB config:', error.message);
        }
      }

      // Queue provisioning delete job on DC (frozen snapshot since host is gone)
      if (host && provisioningService.isProvisioningEnabled()) {
        try {
          await provisioningService.createProvisionJob(
            {
              hostname: host.hostname,
              macAddress: host.macAddress,
              ipAddress: host.ipAddress,
              csvCol0: host.room?.name,
              configName: host.config?.name,
              hostId: host.id,
            },
            'delete'
          );
        } catch (err) {
          console.error('[Hosts] Provisioning queue failed:', err.message);
        }
      }

      res.json({
        data: {
          message: 'Host deleted successfully',
        },
      });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: {
            code: 'HOST_NOT_FOUND',
            message: 'Host not found',
          },
        });
      }
      next(error);
    }
  }
);

/**
 * POST /hosts/:id/wake-on-lan
 * Send Wake-on-LAN packet
 */
router.post(
  '/:id/wake-on-lan',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('host.wol'),
  async (req, res, next) => {
    try {
      const host = await prisma.host.findUnique({
        where: { id: req.params.id },
      });

      if (!host) {
        return res.status(404).json({
          error: {
            code: 'HOST_NOT_FOUND',
            message: 'Host not found',
          },
        });
      }

      // Import WoL service
      const wolService = require('../services/wol.service');
      await wolService.sendWakeOnLan(host.macAddress);

      res.json({
        data: {
          message: 'Wake-on-LAN packet sent',
          hostname: host.hostname,
          macAddress: host.macAddress,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /hosts/:id/sync
 * Start sync operation
 */
router.post(
  '/:id/sync',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('host.sync'),
  async (req, res, next) => {
    try {
      const { forceNew } = req.body || {};

      const host = await prisma.host.findUnique({
        where: { id: req.params.id },
        include: { config: true },
      });

      if (!host) {
        return res.status(404).json({
          error: {
            code: 'HOST_NOT_FOUND',
            message: 'Host not found',
          },
        });
      }

      // Create operation record
      const operation = await prisma.operation.create({
        data: {
          targetHosts: [host.id],
          commands: ['sync'],
          options: { forceNew: forceNew || false },
          status: 'pending',
        },
      });

      // Update host status
      await prisma.host.update({
        where: { id: host.id },
        data: { status: 'syncing' },
      });

      // Broadcast event via WebSocket
      const ws = require('../lib/websocket');
      ws.broadcast('operation.started', {
        operationId: operation.id,
        type: 'sync',
        hostId: host.id,
        hostname: host.hostname,
      });

      res.json({
        data: {
          operationId: operation.id,
          message: 'Sync operation started',
          hostname: host.hostname,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /hosts/:id/start
 * Start OS on host
 */
router.post(
  '/:id/start',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('host.start'),
  async (req, res, next) => {
    try {
      const { osName } = req.body || {};

      const host = await prisma.host.findUnique({
        where: { id: req.params.id },
        include: {
          config: {
            include: {
              osEntries: { orderBy: { position: 'asc' } },
            },
          },
        },
      });

      if (!host) {
        return res.status(404).json({
          error: {
            code: 'HOST_NOT_FOUND',
            message: 'Host not found',
          },
        });
      }

      // Determine which OS to start
      let targetOs = osName;
      if (!targetOs && host.config?.osEntries?.length > 0) {
        targetOs = host.config.osEntries[0].name;
      }

      // Create operation record
      const operation = await prisma.operation.create({
        data: {
          targetHosts: [host.id],
          commands: ['start'],
          options: { osName: targetOs },
          status: 'pending',
        },
      });

      // Broadcast event
      const ws = require('../lib/websocket');
      ws.broadcast('operation.started', {
        operationId: operation.id,
        type: 'start',
        hostId: host.id,
        hostname: host.hostname,
        osName: targetOs,
      });

      res.json({
        data: {
          operationId: operation.id,
          message: 'Start operation initiated',
          hostname: host.hostname,
          osName: targetOs,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /hosts/:id/status
 * Update host status (for LINBO client callbacks)
 */
router.patch(
  '/:id/status',
  authenticateToken,
  async (req, res, next) => {
    try {
      const { status, cacheInfo, hardware } = req.body;

      const updateData = {
        lastSeen: new Date(),
      };
      if (status) updateData.status = status;
      if (cacheInfo) updateData.cacheInfo = cacheInfo;
      if (hardware) updateData.hardware = hardware;

      const host = await prisma.host.update({
        where: { id: req.params.id },
        data: updateData,
      });

      // Broadcast status change
      const ws = require('../lib/websocket');
      ws.broadcast('host.status.changed', {
        hostId: host.id,
        hostname: host.hostname,
        status: host.status,
        lastSeen: host.lastSeen,
      });

      res.json({ data: host });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: {
            code: 'HOST_NOT_FOUND',
            message: 'Host not found',
          },
        });
      }
      next(error);
    }
  }
);

/**
 * POST /hosts/:id/schedule-command
 * Schedule an onboot command for a single host
 */
router.post(
  '/:id/schedule-command',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('host.schedule_command'),
  async (req, res, next) => {
    try {
      const { commands, noauto, disablegui } = req.body;

      if (!commands) {
        return res.status(400).json({
          error: {
            code: 'MISSING_COMMANDS',
            message: 'commands field is required',
          },
        });
      }

      const remoteService = require('../services/remote.service');

      // Validiere Commands
      const validation = remoteService.validateCommandString(commands);
      if (!validation.valid) {
        return res.status(400).json({
          error: {
            code: 'INVALID_COMMANDS',
            message: validation.error,
          },
        });
      }

      const result = await remoteService.scheduleOnbootCommands(
        [req.params.id],
        commands,
        { noauto, disablegui }
      );

      if (result.failed.length > 0) {
        return res.status(400).json({
          error: {
            code: 'SCHEDULE_FAILED',
            message: result.failed[0].error,
          },
        });
      }

      res.status(201).json({
        data: {
          message: 'Command scheduled for next boot',
          hostname: result.created[0],
          commands,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /hosts/:id/scheduled-command
 * Cancel a scheduled onboot command for a host
 */
router.delete(
  '/:id/scheduled-command',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('host.cancel_scheduled_command'),
  async (req, res, next) => {
    try {
      const host = await prisma.host.findUnique({
        where: { id: req.params.id },
        select: { hostname: true },
      });

      if (!host) {
        return res.status(404).json({
          error: {
            code: 'HOST_NOT_FOUND',
            message: 'Host not found',
          },
        });
      }

      const remoteService = require('../services/remote.service');
      const deleted = await remoteService.cancelScheduledCommand(host.hostname);

      if (!deleted) {
        return res.status(404).json({
          error: {
            code: 'NO_SCHEDULED_COMMAND',
            message: 'No scheduled command found for this host',
          },
        });
      }

      res.json({
        data: {
          message: 'Scheduled command cancelled',
          hostname: host.hostname,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
