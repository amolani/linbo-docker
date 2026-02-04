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
      const { page, limit, sortBy, sortOrder, roomId, groupId, status, search } = req.query;

      // Build where clause
      const where = {};
      if (roomId) where.roomId = roomId;
      if (groupId) where.groupId = groupId;
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
            group: { select: { id: true, name: true } },
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
        group: true,
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
        group: { select: { id: true, name: true } },
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
        group: { select: { id: true, name: true } },
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
          group: { select: { id: true, name: true } },
          config: { select: { id: true, name: true } },
        },
      });

      // Invalidate cache
      await redis.delPattern('hosts:*');

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

      const host = await prisma.host.update({
        where: { id: req.params.id },
        data,
        include: {
          room: { select: { id: true, name: true } },
          group: { select: { id: true, name: true } },
          config: { select: { id: true, name: true } },
        },
      });

      // Invalidate cache
      await redis.delPattern('hosts:*');

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
      await prisma.host.delete({
        where: { id: req.params.id },
      });

      // Invalidate cache
      await redis.delPattern('hosts:*');

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

module.exports = router;
