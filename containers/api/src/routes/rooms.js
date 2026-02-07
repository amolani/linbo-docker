/**
 * LINBO Docker - Rooms Routes
 * CRUD operations for room management
 */

const express = require('express');
const router = express.Router();
const { prisma } = require('../lib/prisma');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  validateBody,
  createRoomSchema,
  updateRoomSchema,
} = require('../middleware/validate');
const { auditAction } = require('../middleware/audit');
const redis = require('../lib/redis');
const ws = require('../lib/websocket');

/**
 * GET /rooms
 * List all rooms with host count
 */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const rooms = await prisma.room.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { hosts: true },
        },
      },
    });

    // Transform to include hostCount
    const data = rooms.map(room => ({
      ...room,
      hostCount: room._count.hosts,
      _count: undefined,
    }));

    res.json({ data });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /rooms/:id
 * Get single room with hosts
 */
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const room = await prisma.room.findUnique({
      where: { id: req.params.id },
      include: {
        hosts: {
          orderBy: { hostname: 'asc' },
          include: {
            config: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!room) {
      return res.status(404).json({
        error: {
          code: 'ROOM_NOT_FOUND',
          message: 'Room not found',
        },
      });
    }

    // Calculate status summary
    const statusCounts = room.hosts.reduce((acc, host) => {
      acc[host.status] = (acc[host.status] || 0) + 1;
      return acc;
    }, {});

    res.json({
      data: {
        ...room,
        hostCount: room.hosts.length,
        statusSummary: statusCounts,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /rooms
 * Create new room
 */
router.post(
  '/',
  authenticateToken,
  requireRole(['admin', 'operator']),
  validateBody(createRoomSchema),
  auditAction('room.create', {
    getTargetId: (req, data) => data?.data?.id,
    getTargetName: (req) => req.body.name,
  }),
  async (req, res, next) => {
    try {
      const room = await prisma.room.create({
        data: req.body,
      });

      // Invalidate cache
      await redis.delPattern('rooms:*');

      // Broadcast WS event for reactive frontend
      ws.broadcast('room.created', { id: room.id, name: room.name });

      res.status(201).json({ data: room });
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_ENTRY',
            message: 'A room with this name already exists',
          },
        });
      }
      next(error);
    }
  }
);

/**
 * PATCH /rooms/:id
 * Update room
 */
router.patch(
  '/:id',
  authenticateToken,
  requireRole(['admin', 'operator']),
  validateBody(updateRoomSchema),
  auditAction('room.update', {
    getTargetName: (req, data) => data?.data?.name,
  }),
  async (req, res, next) => {
    try {
      const room = await prisma.room.update({
        where: { id: req.params.id },
        data: req.body,
        include: {
          _count: { select: { hosts: true } },
        },
      });

      // Invalidate cache
      await redis.delPattern('rooms:*');

      // Broadcast WS event for reactive frontend
      ws.broadcast('room.updated', { id: room.id, name: room.name });

      res.json({
        data: {
          ...room,
          hostCount: room._count.hosts,
          _count: undefined,
        },
      });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: {
            code: 'ROOM_NOT_FOUND',
            message: 'Room not found',
          },
        });
      }
      if (error.code === 'P2002') {
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_ENTRY',
            message: 'A room with this name already exists',
          },
        });
      }
      next(error);
    }
  }
);

/**
 * DELETE /rooms/:id
 * Delete room
 */
router.delete(
  '/:id',
  authenticateToken,
  requireRole(['admin']),
  auditAction('room.delete'),
  async (req, res, next) => {
    try {
      // Check if room has hosts
      const room = await prisma.room.findUnique({
        where: { id: req.params.id },
        include: { _count: { select: { hosts: true } } },
      });

      if (!room) {
        return res.status(404).json({
          error: {
            code: 'ROOM_NOT_FOUND',
            message: 'Room not found',
          },
        });
      }

      if (room._count.hosts > 0) {
        return res.status(400).json({
          error: {
            code: 'ROOM_HAS_HOSTS',
            message: `Cannot delete room with ${room._count.hosts} hosts. Remove hosts first.`,
          },
        });
      }

      await prisma.room.delete({
        where: { id: req.params.id },
      });

      // Invalidate cache
      await redis.delPattern('rooms:*');

      // Broadcast WS event for reactive frontend
      ws.broadcast('room.deleted', { id: req.params.id });

      res.json({
        data: {
          message: 'Room deleted successfully',
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /rooms/:id/wake-all
 * Send WoL to all hosts in room
 */
router.post(
  '/:id/wake-all',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('room.wake_all'),
  async (req, res, next) => {
    try {
      const room = await prisma.room.findUnique({
        where: { id: req.params.id },
        include: {
          hosts: { select: { id: true, hostname: true, macAddress: true } },
        },
      });

      if (!room) {
        return res.status(404).json({
          error: {
            code: 'ROOM_NOT_FOUND',
            message: 'Room not found',
          },
        });
      }

      // Send WoL to all hosts
      const wolService = require('../services/wol.service');
      const results = await Promise.allSettled(
        room.hosts.map(host => wolService.sendWakeOnLan(host.macAddress))
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      res.json({
        data: {
          message: `Wake-on-LAN sent to ${successful}/${room.hosts.length} hosts`,
          successful,
          failed,
          roomName: room.name,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /rooms/:id/shutdown-all
 * Shutdown all hosts in room
 */
router.post(
  '/:id/shutdown-all',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('room.shutdown_all'),
  async (req, res, next) => {
    try {
      const room = await prisma.room.findUnique({
        where: { id: req.params.id },
        include: {
          hosts: {
            where: { status: 'online' },
            select: { id: true, hostname: true },
          },
        },
      });

      if (!room) {
        return res.status(404).json({
          error: {
            code: 'ROOM_NOT_FOUND',
            message: 'Room not found',
          },
        });
      }

      if (room.hosts.length === 0) {
        return res.json({
          data: {
            message: 'No online hosts in room',
            roomName: room.name,
          },
        });
      }

      // Create operation for shutdown
      const operation = await prisma.operation.create({
        data: {
          targetHosts: room.hosts.map(h => h.id),
          commands: ['shutdown'],
          options: {},
          status: 'pending',
        },
      });

      // Broadcast event
      const ws = require('../lib/websocket');
      ws.broadcast('operation.started', {
        operationId: operation.id,
        type: 'shutdown',
        roomName: room.name,
        hostCount: room.hosts.length,
      });

      res.json({
        data: {
          operationId: operation.id,
          message: `Shutdown initiated for ${room.hosts.length} hosts`,
          roomName: room.name,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
