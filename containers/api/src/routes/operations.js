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

// =============================================================================
// Remote Command Routes (Phase 7) - MUST be before /:id route!
// =============================================================================

const remoteService = require('../services/remote.service');

/**
 * GET /operations/scheduled
 * List all scheduled onboot commands
 */
router.get('/scheduled', authenticateToken, async (req, res, next) => {
  try {
    const scheduled = await remoteService.listScheduledCommands();
    res.json({ data: scheduled });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /operations/direct
 * Execute commands directly via SSH
 */
router.post(
  '/direct',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('operation.direct'),
  async (req, res, next) => {
    try {
      const { hostIds, roomId, configId, commands, options = {} } = req.body;

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

      // Hosts ermitteln
      let targetHostIds = hostIds;
      if (!targetHostIds || targetHostIds.length === 0) {
        const hosts = await remoteService.getHostsByFilter({ roomId, configId });
        targetHostIds = hosts.map(h => h.id);
      }

      if (targetHostIds.length === 0) {
        return res.status(400).json({
          error: {
            code: 'NO_HOSTS',
            message: 'No hosts found matching the filter',
          },
        });
      }

      // Befehle ausführen
      const result = await remoteService.executeDirectCommands(
        targetHostIds,
        commands,
        options
      );

      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /operations/schedule
 * Schedule onboot commands (.cmd files)
 */
router.post(
  '/schedule',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('operation.schedule'),
  async (req, res, next) => {
    try {
      const { hostIds, roomId, configId, commands, options = {} } = req.body;

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

      // Hosts ermitteln
      let targetHostIds = hostIds;
      if (!targetHostIds || targetHostIds.length === 0) {
        const hosts = await remoteService.getHostsByFilter({ roomId, configId });
        targetHostIds = hosts.map(h => h.id);
      }

      if (targetHostIds.length === 0) {
        return res.status(400).json({
          error: {
            code: 'NO_HOSTS',
            message: 'No hosts found matching the filter',
          },
        });
      }

      // Onboot-Commands erstellen
      const result = await remoteService.scheduleOnbootCommands(
        targetHostIds,
        commands,
        options
      );

      res.status(201).json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /operations/scheduled/:hostname
 * Cancel a scheduled onboot command
 */
router.delete(
  '/scheduled/:hostname',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('operation.cancel_scheduled'),
  async (req, res, next) => {
    try {
      const deleted = await remoteService.cancelScheduledCommand(
        req.params.hostname
      );

      if (!deleted) {
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: `No scheduled command found for host: ${req.params.hostname}`,
          },
        });
      }

      res.json({
        data: {
          message: 'Scheduled command cancelled',
          hostname: req.params.hostname,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /operations/wake
 * Send Wake-on-LAN to hosts with optional follow-up commands
 */
router.post(
  '/wake',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('operation.wake'),
  async (req, res, next) => {
    try {
      const {
        hostIds,
        roomId,
        configId,
        wait,
        commands,
        onboot = false,
        noauto = false,
        disablegui = false,
      } = req.body;

      // Validiere Commands wenn angegeben
      if (commands) {
        const validation = remoteService.validateCommandString(commands);
        if (!validation.valid) {
          return res.status(400).json({
            error: {
              code: 'INVALID_COMMANDS',
              message: validation.error,
            },
          });
        }
      }

      const result = await remoteService.wakeAndExecute(
        { hostIds, roomId, configId },
        { wait, commands, onboot, noauto, disablegui }
      );

      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /operations/validate-commands
 * Validate a command string without executing
 */
router.post('/validate-commands', authenticateToken, async (req, res, next) => {
  try {
    const { commands } = req.body;

    if (!commands) {
      return res.status(400).json({
        error: {
          code: 'MISSING_COMMANDS',
          message: 'commands field is required',
        },
      });
    }

    const result = remoteService.validateCommandString(commands);

    res.json({
      data: {
        valid: result.valid,
        error: result.error,
        parsed: result.commands,
        knownCommands: remoteService.KNOWN_COMMANDS,
        specialFlags: remoteService.SPECIAL_FLAGS,
      },
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// Machine Account (macct) Routes - Phase 8
// =============================================================================

const macctService = require('../services/macct.service');

/**
 * POST /operations/macct-repair
 * Manually trigger a machine account repair job
 */
router.post(
  '/macct-repair',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('operation.macct_repair'),
  async (req, res, next) => {
    try {
      const { hostname, hostId, school } = req.body;

      // Get hostname from hostId if not provided directly
      let targetHostname = hostname;
      if (!targetHostname && hostId) {
        const host = await prisma.host.findUnique({
          where: { id: hostId },
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
        targetHostname = host.hostname;
      }

      if (!targetHostname) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'hostname or hostId is required',
          },
        });
      }

      const result = await macctService.createMacctRepairJob(
        targetHostname,
        school || 'default-school',
        { triggeredBy: 'api', requestedBy: req.user?.username }
      );

      res.status(result.queued ? 201 : 200).json({
        data: {
          operationId: result.operation.id,
          hostname: targetHostname,
          status: result.queued ? 'queued' : 'already_queued',
          message: result.message,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /operations/macct
 * List machine account repair jobs
 */
router.get('/macct', authenticateToken, async (req, res, next) => {
  try {
    const { status, hostname, school, page, limit } = req.query;

    const result = await macctService.listMacctJobs({
      status,
      hostname,
      school,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 50,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /operations/macct/stream-info
 * Get Redis stream information for monitoring
 */
router.get(
  '/macct/stream-info',
  authenticateToken,
  requireRole(['admin']),
  async (req, res, next) => {
    try {
      const [streamInfo, pendingJobs] = await Promise.all([
        macctService.getStreamInfo(),
        macctService.getPendingJobs(),
      ]);

      res.json({
        data: {
          ...streamInfo,
          pending: pendingJobs,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /operations/macct/:id
 * Get machine account operation status
 */
router.get('/macct/:id', authenticateToken, async (req, res, next) => {
  try {
    const operation = await macctService.getOperationStatus(req.params.id);

    if (!operation) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Operation not found',
        },
      });
    }

    res.json({ data: operation });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /operations/macct/:id/retry
 * Retry a failed macct operation
 */
router.post(
  '/macct/:id/retry',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('operation.macct_retry'),
  async (req, res, next) => {
    try {
      const result = await macctService.retryJob(req.params.id);

      if (!result.success) {
        return res.status(400).json({
          error: {
            code: 'RETRY_FAILED',
            message: result.message,
          },
        });
      }

      res.json({
        data: {
          operationId: req.params.id,
          attempt: result.attempt,
          message: 'Job re-queued for retry',
        },
      });
    } catch (error) {
      if (error.message === 'Operation not found') {
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Operation not found',
          },
        });
      }
      next(error);
    }
  }
);

// =============================================================================
// Standard Operation Routes
// =============================================================================

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
