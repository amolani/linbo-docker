/**
 * LINBO Docker - Groups Routes
 * CRUD operations for host group management
 */

const express = require('express');
const router = express.Router();
const { prisma } = require('../lib/prisma');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  validateBody,
  createGroupSchema,
  updateGroupSchema,
} = require('../middleware/validate');
const { auditAction } = require('../middleware/audit');
const redis = require('../lib/redis');

/**
 * GET /groups
 * List all groups with host count
 */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const groups = await prisma.hostGroup.findMany({
      orderBy: { name: 'asc' },
      include: {
        defaultConfig: { select: { id: true, name: true } },
        _count: {
          select: { hosts: true },
        },
      },
    });

    // Transform to include hostCount
    const data = groups.map(group => ({
      ...group,
      hostCount: group._count.hosts,
      _count: undefined,
    }));

    res.json({ data });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /groups/:id
 * Get single group with hosts
 */
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const group = await prisma.hostGroup.findUnique({
      where: { id: req.params.id },
      include: {
        defaultConfig: {
          include: {
            partitions: { orderBy: { position: 'asc' } },
            osEntries: { orderBy: { position: 'asc' } },
          },
        },
        hosts: {
          orderBy: { hostname: 'asc' },
          include: {
            room: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!group) {
      return res.status(404).json({
        error: {
          code: 'GROUP_NOT_FOUND',
          message: 'Group not found',
        },
      });
    }

    res.json({
      data: {
        ...group,
        hostCount: group.hosts.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /groups
 * Create new group
 */
router.post(
  '/',
  authenticateToken,
  requireRole(['admin', 'operator']),
  validateBody(createGroupSchema),
  auditAction('group.create', {
    getTargetId: (req, data) => data?.data?.id,
    getTargetName: (req) => req.body.name,
  }),
  async (req, res, next) => {
    try {
      const group = await prisma.hostGroup.create({
        data: req.body,
        include: {
          defaultConfig: { select: { id: true, name: true } },
        },
      });

      // Invalidate cache
      await redis.delPattern('groups:*');

      res.status(201).json({ data: group });
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_ENTRY',
            message: 'A group with this name already exists',
          },
        });
      }
      next(error);
    }
  }
);

/**
 * PATCH /groups/:id
 * Update group
 */
router.patch(
  '/:id',
  authenticateToken,
  requireRole(['admin', 'operator']),
  validateBody(updateGroupSchema),
  auditAction('group.update', {
    getTargetName: (req, data) => data?.data?.name,
  }),
  async (req, res, next) => {
    try {
      const group = await prisma.hostGroup.update({
        where: { id: req.params.id },
        data: req.body,
        include: {
          defaultConfig: { select: { id: true, name: true } },
          _count: { select: { hosts: true } },
        },
      });

      // Invalidate cache
      await redis.delPattern('groups:*');

      res.json({
        data: {
          ...group,
          hostCount: group._count.hosts,
          _count: undefined,
        },
      });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: {
            code: 'GROUP_NOT_FOUND',
            message: 'Group not found',
          },
        });
      }
      if (error.code === 'P2002') {
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_ENTRY',
            message: 'A group with this name already exists',
          },
        });
      }
      next(error);
    }
  }
);

/**
 * DELETE /groups/:id
 * Delete group
 */
router.delete(
  '/:id',
  authenticateToken,
  requireRole(['admin']),
  auditAction('group.delete'),
  async (req, res, next) => {
    try {
      // Check if group has hosts
      const group = await prisma.hostGroup.findUnique({
        where: { id: req.params.id },
        include: { _count: { select: { hosts: true } } },
      });

      if (!group) {
        return res.status(404).json({
          error: {
            code: 'GROUP_NOT_FOUND',
            message: 'Group not found',
          },
        });
      }

      if (group._count.hosts > 0) {
        return res.status(400).json({
          error: {
            code: 'GROUP_HAS_HOSTS',
            message: `Cannot delete group with ${group._count.hosts} hosts. Remove hosts first.`,
          },
        });
      }

      await prisma.hostGroup.delete({
        where: { id: req.params.id },
      });

      // Invalidate cache
      await redis.delPattern('groups:*');

      res.json({
        data: {
          message: 'Group deleted successfully',
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /groups/:id/apply-config
 * Apply config to all hosts in group
 */
router.post(
  '/:id/apply-config',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('group.apply_config'),
  async (req, res, next) => {
    try {
      const { configId } = req.body;

      if (!configId) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'configId is required',
          },
        });
      }

      // Verify group and config exist
      const [group, config] = await Promise.all([
        prisma.hostGroup.findUnique({ where: { id: req.params.id } }),
        prisma.config.findUnique({ where: { id: configId } }),
      ]);

      if (!group) {
        return res.status(404).json({
          error: {
            code: 'GROUP_NOT_FOUND',
            message: 'Group not found',
          },
        });
      }

      if (!config) {
        return res.status(404).json({
          error: {
            code: 'CONFIG_NOT_FOUND',
            message: 'Config not found',
          },
        });
      }

      // Update all hosts in group
      const result = await prisma.host.updateMany({
        where: { groupId: req.params.id },
        data: { configId },
      });

      // Invalidate cache
      await redis.delPattern('hosts:*');

      res.json({
        data: {
          message: `Config applied to ${result.count} hosts`,
          updatedCount: result.count,
          groupName: group.name,
          configName: config.name,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /groups/:id/wake-all
 * Send WoL to all hosts in group
 */
router.post(
  '/:id/wake-all',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('group.wake_all'),
  async (req, res, next) => {
    try {
      const group = await prisma.hostGroup.findUnique({
        where: { id: req.params.id },
        include: {
          hosts: { select: { id: true, hostname: true, macAddress: true } },
        },
      });

      if (!group) {
        return res.status(404).json({
          error: {
            code: 'GROUP_NOT_FOUND',
            message: 'Group not found',
          },
        });
      }

      // Send WoL to all hosts
      const wolService = require('../services/wol.service');
      const results = await Promise.allSettled(
        group.hosts.map(host => wolService.sendWakeOnLan(host.macAddress))
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      res.json({
        data: {
          message: `Wake-on-LAN sent to ${successful}/${group.hosts.length} hosts`,
          successful,
          failed,
          groupName: group.name,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
