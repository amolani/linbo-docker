/**
 * LINBO Docker - Sync Operations Routes
 * Operations endpoints for sync mode (Redis-based, no Prisma).
 *
 * Endpoints:
 *   GET  /              — List operations (paginated)
 *   GET  /:id           — Get operation with sessions
 *   GET  /scheduled     — List scheduled onboot commands
 *   POST /validate-commands — Validate command string
 *   POST /direct        — Execute commands directly via SSH
 *   POST /schedule      — Schedule onboot commands (.cmd files)
 *   DELETE /scheduled/:hostname — Cancel scheduled command
 *   POST /wake          — Wake hosts via WoL
 *   POST /:id/cancel    — Cancel running operation
 */

const express = require('express');
const router = express.Router();
const syncOps = require('../services/sync-operations.service');
const ws = require('../lib/websocket');

const {
  validateCommandString,
  listScheduledCommands,
  sanitizeHostname,
} = syncOps;

// Auth middleware (Prisma-optional, same pattern as sync.js)
let authenticate, requireAdmin;
try {
  const auth = require('../middleware/auth');
  authenticate = auth.authenticateToken;
  requireAdmin = auth.requireRole(['admin']);
} catch {
  authenticate = (req, res, next) => next();
  requireAdmin = (req, res, next) => next();
}

// All routes require authentication
router.use(authenticate);

// ---------------------------------------------------------------------------
// GET /operations — List operations
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 25, status } = req.query;
    const result = await syncOps.listOperations({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 25,
      status: status || undefined,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /operations/scheduled — List scheduled onboot commands
// ---------------------------------------------------------------------------
router.get('/scheduled', async (req, res, next) => {
  try {
    const scheduled = await listScheduledCommands();
    res.json({ data: scheduled });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /operations/validate-commands — Validate command string
// ---------------------------------------------------------------------------
router.post('/validate-commands', async (req, res, next) => {
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

    const result = validateCommandString(commands);
    const remoteService = require('../services/remote.service');

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

// ---------------------------------------------------------------------------
// POST /operations/direct — Execute commands directly via SSH
// ---------------------------------------------------------------------------
router.post('/direct', requireAdmin, async (req, res, next) => {
  try {
    const { macs, hostnames, hostgroup, room, commands, options = {} } = req.body;

    if (!commands) {
      return res.status(400).json({
        error: { code: 'MISSING_COMMANDS', message: 'commands field is required' },
      });
    }

    const validation = validateCommandString(commands);
    if (!validation.valid) {
      return res.status(400).json({
        error: { code: 'INVALID_COMMANDS', message: validation.error },
      });
    }

    const filter = buildFilter({ macs, hostnames, hostgroup, room });
    if (!filter) {
      return res.status(400).json({
        error: { code: 'NO_FILTER', message: 'At least one filter (macs, hostnames, hostgroup, room) is required' },
      });
    }

    const result = await syncOps.executeDirectCommands(filter, commands, options);
    res.json({ data: result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: { code: 'OPERATION_ERROR', message: error.message },
      });
    }
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /operations/schedule — Schedule onboot commands (.cmd files)
// ---------------------------------------------------------------------------
router.post('/schedule', requireAdmin, async (req, res, next) => {
  try {
    const { macs, hostnames, hostgroup, room, commands, options = {} } = req.body;

    if (!commands) {
      return res.status(400).json({
        error: { code: 'MISSING_COMMANDS', message: 'commands field is required' },
      });
    }

    const validation = validateCommandString(commands);
    if (!validation.valid) {
      return res.status(400).json({
        error: { code: 'INVALID_COMMANDS', message: validation.error },
      });
    }

    const filter = buildFilter({ macs, hostnames, hostgroup, room });
    if (!filter) {
      return res.status(400).json({
        error: { code: 'NO_FILTER', message: 'At least one filter (macs, hostnames, hostgroup, room) is required' },
      });
    }

    const result = await syncOps.scheduleOnbootCommands(filter, commands, options);
    res.status(201).json({ data: result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: { code: 'OPERATION_ERROR', message: error.message },
      });
    }
    next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /operations/scheduled/:hostname — Cancel scheduled command
// ---------------------------------------------------------------------------
router.delete('/scheduled/:hostname', requireAdmin, async (req, res, next) => {
  try {
    sanitizeHostname(req.params.hostname);

    const remoteService = require('../services/remote.service');
    const deleted = await remoteService.cancelScheduledCommand(req.params.hostname);

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
    if (error.message && error.message.includes('Invalid hostname')) {
      return res.status(400).json({
        error: { code: 'INVALID_HOSTNAME', message: error.message },
      });
    }
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /operations/wake — Wake hosts via WoL
// ---------------------------------------------------------------------------
router.post('/wake', requireAdmin, async (req, res, next) => {
  try {
    const {
      macs,
      hostnames,
      hostgroup,
      room,
      wait,
      commands,
      onboot = false,
      noauto = false,
      disablegui = false,
    } = req.body;

    // Validate commands if provided
    if (commands) {
      const validation = validateCommandString(commands);
      if (!validation.valid) {
        return res.status(400).json({
          error: { code: 'INVALID_COMMANDS', message: validation.error },
        });
      }
    }

    const filter = buildFilter({ macs, hostnames, hostgroup, room });
    if (!filter) {
      return res.status(400).json({
        error: { code: 'NO_FILTER', message: 'At least one filter (macs, hostnames, hostgroup, room) is required' },
      });
    }

    const result = await syncOps.wakeHosts(filter, {
      wait,
      commands,
      onboot,
      noauto,
      disablegui,
    });

    res.json({ data: result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: { code: 'OPERATION_ERROR', message: error.message },
      });
    }
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /operations/:id — Get single operation with sessions
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res, next) => {
  try {
    const op = await syncOps.getOperation(req.params.id);

    if (!op) {
      return res.status(404).json({
        error: {
          code: 'OPERATION_NOT_FOUND',
          message: 'Operation not found',
        },
      });
    }

    res.json({ data: op });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /operations/:id/cancel — Cancel running operation
// ---------------------------------------------------------------------------
router.post('/:id/cancel', requireAdmin, async (req, res, next) => {
  try {
    const result = await syncOps.cancelOperation(req.params.id);
    res.json({ data: result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: { code: 'OPERATION_ERROR', message: error.message },
      });
    }
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Build filter object from request body.
 * Returns null if no valid filter found.
 */
function buildFilter({ macs, hostnames, hostgroup, room }) {
  if (macs && Array.isArray(macs) && macs.length > 0) {
    return { macs };
  }
  if (hostnames && Array.isArray(hostnames) && hostnames.length > 0) {
    return { hostnames };
  }
  if (hostgroup) {
    return { hostgroup, ...(room ? { room } : {}) };
  }
  if (room) {
    return { room };
  }
  return null;
}

module.exports = router;
