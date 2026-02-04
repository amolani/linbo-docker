/**
 * LINBO Docker - Operations Routes
 * Bulk operations and command execution
 */

const express = require('express');
const router = express.Router();
const { prisma } = require('../lib/prisma');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  validateBody,
  createOperationSchema,
  sendCommandSchema,
} = require('../middleware/validate');
const { auditAction } = require('../middleware/audit');
const ws = require('../lib/websocket');

/**
 * GET /operations
 * List operations with filters
 */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;

    const where = {};
    if (status) where.status = status;

    const [operations, total] = await Promise.all([
      prisma.operation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: parseInt(limit, 10),
        include: {
          sessions: {
            select: {
              id: true,
              hostname: true,
              status: true,
              progress: true,
            },
          },
        },
      }),
      prisma.operation.count({ where }),
    ]);

    res.json({
      data: operations,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /operations/:id
 * Get single operation with sessions
 */
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const operation = await prisma.operation.findUnique({
      where: { id: req.params.id },
      include: {
        sessions: {
          include: {
            host: { select: { id: true, hostname: true, macAddress: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!operation) {
      return res.status(404).json({
        error: {
          code: 'OPERATION_NOT_FOUND',
          message: 'Operation not found',
        },
      });
    }

    // Calculate summary
    const summary = {
      total: operation.sessions.length,
      pending: operation.sessions.filter(s => s.status === 'pending').length,
      running: operation.sessions.filter(s => s.status === 'running').length,
      completed: operation.sessions.filter(s => s.status === 'completed').length,
      failed: operation.sessions.filter(s => s.status === 'failed').length,
    };

    res.json({
      data: {
        ...operation,
        summary,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /operations
 * Create new operation
 */
router.post(
  '/',
  authenticateToken,
  requireRole(['admin', 'operator']),
  validateBody(createOperationSchema),
  auditAction('operation.create', {
    getTargetId: (req, data) => data?.data?.id,
  }),
  async (req, res, next) => {
    try {
      const { targetHosts, commands, options } = req.body;

      // Verify all target hosts exist
      const hosts = await prisma.host.findMany({
        where: { id: { in: targetHosts } },
        select: { id: true, hostname: true, macAddress: true, status: true },
      });

      if (hosts.length !== targetHosts.length) {
        const found = new Set(hosts.map(h => h.id));
        const notFound = targetHosts.filter(id => !found.has(id));
        return res.status(400).json({
          error: {
            code: 'HOSTS_NOT_FOUND',
            message: `Some hosts not found: ${notFound.join(', ')}`,
          },
        });
      }

      // Create operation with sessions
      const operation = await prisma.operation.create({
        data: {
          targetHosts,
          commands,
          options,
          status: 'pending',
          sessions: {
            create: hosts.map(host => ({
              hostId: host.id,
              hostname: host.hostname,
              status: 'pending',
            })),
          },
        },
        include: {
          sessions: {
            include: {
              host: { select: { id: true, hostname: true } },
            },
          },
        },
      });

      // Broadcast operation started
      ws.broadcast('operation.started', {
        operationId: operation.id,
        commands,
        hostCount: hosts.length,
        hosts: hosts.map(h => ({ id: h.id, hostname: h.hostname })),
      });

      res.status(201).json({ data: operation });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /operations/send-command
 * Send command to multiple hosts
 */
router.post(
  '/send-command',
  authenticateToken,
  requireRole(['admin', 'operator']),
  validateBody(sendCommandSchema),
  auditAction('operation.send_command'),
  async (req, res, next) => {
    try {
      const { targetHosts, command, osName, forceNew } = req.body;

      // Get target hosts
      const hosts = await prisma.host.findMany({
        where: { id: { in: targetHosts } },
        select: { id: true, hostname: true, macAddress: true, status: true },
      });

      if (hosts.length === 0) {
        return res.status(400).json({
          error: {
            code: 'NO_HOSTS',
            message: 'No valid target hosts found',
          },
        });
      }

      // Build command options
      const options = {};
      if (osName) options.osName = osName;
      if (forceNew) options.forceNew = forceNew;

      // Handle different commands
      let operation;
      switch (command) {
        case 'wake':
          // WoL doesn't need operation record, just send packets
          const wolService = require('../services/wol.service');
          const wolResults = await Promise.allSettled(
            hosts.map(host => wolService.sendWakeOnLan(host.macAddress))
          );

          const successful = wolResults.filter(r => r.status === 'fulfilled').length;

          ws.broadcast('operation.completed', {
            type: 'wake',
            hostCount: hosts.length,
            successful,
          });

          return res.json({
            data: {
              command: 'wake',
              hostCount: hosts.length,
              successful,
              failed: hosts.length - successful,
            },
          });

        case 'sync':
        case 'start':
        case 'reboot':
        case 'shutdown':
          // Create operation record
          operation = await prisma.operation.create({
            data: {
              targetHosts: hosts.map(h => h.id),
              commands: [command],
              options,
              status: 'pending',
              sessions: {
                create: hosts.map(host => ({
                  hostId: host.id,
                  hostname: host.hostname,
                  status: 'pending',
                })),
              },
            },
            include: {
              sessions: true,
            },
          });

          // Update host status for sync
          if (command === 'sync') {
            await prisma.host.updateMany({
              where: { id: { in: hosts.map(h => h.id) } },
              data: { status: 'syncing' },
            });
          }

          // Broadcast event
          ws.broadcast('operation.started', {
            operationId: operation.id,
            command,
            options,
            hostCount: hosts.length,
          });

          return res.json({
            data: {
              operationId: operation.id,
              command,
              hostCount: hosts.length,
              options,
              status: 'pending',
            },
          });

        default:
          return res.status(400).json({
            error: {
              code: 'INVALID_COMMAND',
              message: `Unknown command: ${command}`,
            },
          });
      }
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /operations/:id
 * Update operation status
 */
router.patch(
  '/:id',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('operation.update'),
  async (req, res, next) => {
    try {
      const { status, progress, stats } = req.body;

      const updateData = {};
      if (status) {
        updateData.status = status;
        if (status === 'running' && !updateData.startedAt) {
          updateData.startedAt = new Date();
        }
        if (['completed', 'failed', 'cancelled'].includes(status)) {
          updateData.completedAt = new Date();
        }
      }
      if (progress !== undefined) updateData.progress = progress;
      if (stats) updateData.stats = stats;

      const operation = await prisma.operation.update({
        where: { id: req.params.id },
        data: updateData,
        include: {
          sessions: {
            select: { id: true, status: true, progress: true },
          },
        },
      });

      // Broadcast status change
      ws.broadcast('operation.updated', {
        operationId: operation.id,
        status: operation.status,
        progress: operation.progress,
      });

      if (['completed', 'failed', 'cancelled'].includes(operation.status)) {
        ws.broadcast('operation.completed', {
          operationId: operation.id,
          status: operation.status,
          stats: operation.stats,
        });
      }

      res.json({ data: operation });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: {
            code: 'OPERATION_NOT_FOUND',
            message: 'Operation not found',
          },
        });
      }
      next(error);
    }
  }
);

/**
 * POST /operations/:id/cancel
 * Cancel running operation
 */
router.post(
  '/:id/cancel',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('operation.cancel'),
  async (req, res, next) => {
    try {
      const operation = await prisma.operation.findUnique({
        where: { id: req.params.id },
      });

      if (!operation) {
        return res.status(404).json({
          error: {
            code: 'OPERATION_NOT_FOUND',
            message: 'Operation not found',
          },
        });
      }

      if (['completed', 'failed', 'cancelled'].includes(operation.status)) {
        return res.status(400).json({
          error: {
            code: 'OPERATION_FINISHED',
            message: `Operation is already ${operation.status}`,
          },
        });
      }

      // Update operation and pending sessions
      await prisma.$transaction([
        prisma.operation.update({
          where: { id: req.params.id },
          data: {
            status: 'cancelled',
            completedAt: new Date(),
          },
        }),
        prisma.session.updateMany({
          where: {
            operationId: req.params.id,
            status: { in: ['pending', 'running'] },
          },
          data: { status: 'cancelled' },
        }),
      ]);

      // Broadcast cancellation
      ws.broadcast('operation.cancelled', {
        operationId: operation.id,
      });

      res.json({
        data: {
          message: 'Operation cancelled',
          operationId: operation.id,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /operations/:operationId/sessions/:sessionId
 * Update session status
 */
router.patch(
  '/:operationId/sessions/:sessionId',
  authenticateToken,
  async (req, res, next) => {
    try {
      const { status, progress, logFile } = req.body;

      const updateData = {};
      if (status) {
        updateData.status = status;
        if (status === 'running') updateData.startedAt = new Date();
        if (['completed', 'failed'].includes(status)) updateData.completedAt = new Date();
      }
      if (progress !== undefined) updateData.progress = progress;
      if (logFile) updateData.logFile = logFile;

      const session = await prisma.session.update({
        where: { id: req.params.sessionId },
        data: updateData,
        include: {
          host: { select: { id: true, hostname: true } },
          operation: { select: { id: true, commands: true } },
        },
      });

      // Broadcast session update
      ws.broadcast('session.updated', {
        operationId: session.operationId,
        sessionId: session.id,
        hostId: session.host?.id,
        hostname: session.hostname,
        status: session.status,
        progress: session.progress,
      });

      // Check if operation is complete
      if (['completed', 'failed'].includes(session.status)) {
        const pendingSessions = await prisma.session.count({
          where: {
            operationId: req.params.operationId,
            status: { in: ['pending', 'running'] },
          },
        });

        if (pendingSessions === 0) {
          // All sessions done, update operation
          const allSessions = await prisma.session.findMany({
            where: { operationId: req.params.operationId },
          });

          const stats = {
            total: allSessions.length,
            completed: allSessions.filter(s => s.status === 'completed').length,
            failed: allSessions.filter(s => s.status === 'failed').length,
          };

          const operationStatus = stats.failed === 0 ? 'completed' : 'completed_with_errors';

          await prisma.operation.update({
            where: { id: req.params.operationId },
            data: {
              status: operationStatus,
              completedAt: new Date(),
              stats,
              progress: 100,
            },
          });

          ws.broadcast('operation.completed', {
            operationId: req.params.operationId,
            status: operationStatus,
            stats,
          });
        }
      }

      res.json({ data: session });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: {
            code: 'SESSION_NOT_FOUND',
            message: 'Session not found',
          },
        });
      }
      next(error);
    }
  }
);

module.exports = router;
