/**
 * LINBO Docker - Terminal Routes
 * REST endpoints for SSH terminal session management.
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const terminalService = require('../services/terminal.service');
const sshService = require('../services/ssh.service');

// All terminal endpoints require authentication
router.use(authenticateToken);

/**
 * GET /terminal/sessions — List active terminal sessions
 */
router.get('/sessions', (req, res) => {
  const sessions = terminalService.listSessions();
  res.json({ data: sessions });
});

/**
 * DELETE /terminal/sessions/:id — Close a terminal session
 */
router.delete('/sessions/:id', (req, res) => {
  const session = terminalService.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Session not found' },
    });
  }
  terminalService.destroySession(req.params.id);
  res.json({ data: { message: 'Session closed' } });
});

/**
 * POST /terminal/test-connection — Test SSH connectivity to a host
 */
router.post('/test-connection', async (req, res) => {
  const { hostIp } = req.body;
  if (!hostIp) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'hostIp is required' },
    });
  }

  try {
    const result = await sshService.testConnection(hostIp);
    res.json({ data: result });
  } catch (err) {
    res.json({ data: { success: false, error: err.message } });
  }
});

module.exports = router;
