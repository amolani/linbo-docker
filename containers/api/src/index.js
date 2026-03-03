/**
 * LINBO Docker - API Server
 * Main entry point with Prisma, Redis, and modular routes
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');

// Load environment variables
require('dotenv').config();

// BigInt JSON serialization support
BigInt.prototype.toJSON = function () { return Number(this); };

// Import libraries — Prisma is optional (DB-free mode when SYNC_ENABLED)
let prisma, connectWithRetry, disconnectPrisma;
try {
  const prismaLib = require('./lib/prisma');
  prisma = prismaLib.prisma;
  connectWithRetry = prismaLib.connectWithRetry;
  disconnectPrisma = prismaLib.disconnect;
} catch {
  prisma = null;
  connectWithRetry = async () => {};
  disconnectPrisma = async () => {};
}
const redis = require('./lib/redis');
const websocket = require('./lib/websocket');
const WebSocket = require('ws');

// Import route factory (async — called after Redis is ready)
const createRouter = require('./routes');

// =============================================================================
// Express App Setup
// =============================================================================
const app = express();
const server = http.createServer(app);

// =============================================================================
// Middleware
// =============================================================================
app.use(helmet({
  contentSecurityPolicy: false, // Disable for API
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Add request ID for tracking
app.use((req, res, next) => {
  req.requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

// =============================================================================
// Health Check Endpoints
// =============================================================================
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
    serverIp: process.env.LINBO_SERVER_IP || '10.0.0.1',
    services: {
      api: 'up',
      database: 'unknown',
      redis: 'unknown',
      websocket: 'unknown',
    },
  };

  // Check database connection (optional in DB-free mode)
  if (prisma) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      health.services.database = 'up';
    } catch (err) {
      health.services.database = 'down';
      health.status = 'degraded';
    }
  } else {
    health.services.database = 'disabled';
  }

  // Check Redis connection
  try {
    const redisClient = redis.getClient();
    if (redisClient && redisClient.status === 'ready') {
      await redisClient.ping();
      health.services.redis = 'up';
    } else {
      health.services.redis = 'down';
      health.status = 'degraded';
    }
  } catch (err) {
    health.services.redis = 'down';
    health.status = 'degraded';
  }

  // Check WebSocket
  const wss = websocket.getServer();
  if (wss) {
    health.services.websocket = 'up';
    health.websocketClients = wss.clients.size;
  } else {
    health.services.websocket = 'down';
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

app.get('/ready', async (req, res) => {
  try {
    // Check if Redis is ready (always needed)
    const redisClient = redis.getClient();
    if (redisClient && redisClient.status === 'ready') {
      await redisClient.ping();
    } else {
      throw new Error('Redis not ready');
    }

    // Check DB if available (optional in DB-free mode)
    if (prisma) {
      await prisma.$queryRaw`SELECT 1`;
    }

    res.json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({
      status: 'not ready',
      error: err.message || 'Service not available',
      timestamp: new Date().toISOString(),
    });
  }
});

// =============================================================================
// API Routes + Error Handlers (mounted in startServer() after Redis is connected)
// =============================================================================

// =============================================================================
// Server Startup
// =============================================================================
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function startServer() {
  console.log('Starting LINBO Docker API Server...\n');

  // Connect to database (optional — skipped in DB-free/sync mode)
  if (prisma) {
    console.log('Connecting to PostgreSQL...');
    try {
      await connectWithRetry(5, 3000);
      console.log('  PostgreSQL connected');
    } catch (err) {
      console.error('  PostgreSQL connection failed:', err.message);
      console.log('  Server will start, but database operations will fail');
    }
  } else {
    console.log('PostgreSQL: disabled (DB-free mode)');
  }

  // Connect to Redis
  console.log('Connecting to Redis...');
  try {
    const redisClient = redis.getClient();
    // Wait for connection
    await new Promise((resolve, reject) => {
      if (redisClient.status === 'ready') {
        resolve();
      } else {
        redisClient.once('ready', resolve);
        redisClient.once('error', reject);
        setTimeout(() => reject(new Error('Redis connection timeout')), 5000);
      }
    });
    console.log('  Redis connected');

    // Initialize macct consumer group for DC workers
    const macctService = require('./services/macct.service');
    await macctService.initializeConsumerGroup();
    console.log('  Macct consumer group initialized');
  } catch (err) {
    console.error('  Redis connection failed:', err.message);
    console.log('  Server will start, but caching will be disabled');
  }

  // Mount API routes (after Redis is ready so sync_enabled setting can be read)
  console.log('Mounting API routes...');
  const apiRoutes = await createRouter();
  app.use('/api/v1', apiRoutes);

  // 404 Handler (must be after route mounting)
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.path} not found`,
        requestId: req.requestId,
      },
    });
  });

  // Global Error Handler (must be after route mounting)
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);

    if (err.code && err.code.startsWith('P')) {
      return res.status(400).json({
        error: {
          code: 'DATABASE_ERROR',
          message: 'Database operation failed',
          details: process.env.NODE_ENV === 'development' ? err.message : undefined,
          requestId: req.requestId,
        },
      });
    }

    if (err.name === 'ZodError') {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: err.errors,
          requestId: req.requestId,
        },
      });
    }

    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: {
          code: 'AUTH_ERROR',
          message: err.message,
          requestId: req.requestId,
        },
      });
    }

    res.status(err.status || 500).json({
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: err.message || 'Internal server error',
        requestId: req.requestId,
      },
    });
  });

  // Initialize WebSocket Server
  console.log('Initializing WebSocket...');
  const wss = new WebSocket.Server({ server, path: '/ws' });

  // Setup WebSocket connection handling
  wss.on('connection', (ws, req) => {
    console.log('WebSocket client connected from:', req.socket.remoteAddress);
    ws.channels = [];

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        if (data.type === 'subscribe') {
          ws.channels = data.channels || [];
          ws.send(JSON.stringify({
            type: 'subscribed',
            channels: ws.channels,
            timestamp: new Date().toISOString(),
          }));
        } else if (data.type === 'ping') {
          ws.send(JSON.stringify({
            type: 'pong',
            timestamp: new Date().toISOString(),
          }));
        }
      } catch (err) {
        console.error('WebSocket message error:', err.message);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err.message);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to LINBO Docker API WebSocket',
      timestamp: new Date().toISOString(),
    }));
  });

  // Initialize websocket utilities with server instance
  websocket.init(wss);
  console.log('  WebSocket initialized');

  // Initialize Terminal WebSocket Server (dedicated path for interactive SSH)
  const terminalService = require('./services/terminal.service');
  const { verifyToken } = require('./middleware/auth');
  const terminalWss = new WebSocket.Server({ server, path: '/ws/terminal' });

  terminalWss.on('connection', (ws, req) => {
    // Authenticate via ?token= query param
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    let user;
    try {
      user = verifyToken(token);
    } catch (err) {
      ws.close(4001, 'Authentication failed');
      return;
    }

    console.log(`[Terminal WS] Client connected: ${user.username}`);

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        ws.send(JSON.stringify({ type: 'terminal.error', error: 'Invalid JSON' }));
        return;
      }

      try {
        switch (msg.type) {
          case 'terminal.open': {
            const { hostIp, cols, rows } = msg;
            if (!hostIp) {
              ws.send(JSON.stringify({ type: 'terminal.error', error: 'hostIp required' }));
              return;
            }
            const sessionId = await terminalService.createSession(hostIp, user.id || user.username, {
              cols: cols || 80,
              rows: rows || 24,
              onData: (data) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'terminal.output', sessionId, data }));
                }
              },
              onClose: (reason) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'terminal.closed', sessionId, reason }));
                }
              },
              onError: (error) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'terminal.error', sessionId, error }));
                }
              },
            });
            ws.send(JSON.stringify({ type: 'terminal.opened', sessionId, hostIp }));
            break;
          }

          case 'terminal.input': {
            const { sessionId, data } = msg;
            if (!sessionId || data == null) return;
            terminalService.writeToSession(sessionId, data);
            break;
          }

          case 'terminal.resize': {
            const { sessionId, cols, rows } = msg;
            if (!sessionId) return;
            terminalService.resizeSession(sessionId, cols || 80, rows || 24);
            break;
          }

          case 'terminal.close': {
            const { sessionId } = msg;
            if (!sessionId) return;
            terminalService.destroySession(sessionId);
            break;
          }

          default:
            ws.send(JSON.stringify({ type: 'terminal.error', error: `Unknown message type: ${msg.type}` }));
        }
      } catch (err) {
        ws.send(JSON.stringify({
          type: 'terminal.error',
          sessionId: msg.sessionId,
          error: err.message,
        }));
      }
    });

    ws.on('close', () => {
      console.log(`[Terminal WS] Client disconnected: ${user.username}`);
      // Close all sessions owned by this WS connection
      for (const s of terminalService.listSessions()) {
        if (s.userId === (user.id || user.username)) {
          terminalService.destroySession(s.id);
        }
      }
    });
  });

  server._terminalWss = terminalWss;
  console.log('  Terminal WebSocket initialized');

  // Start Operation Worker (unless disabled)
  if (process.env.ENABLE_OPERATION_WORKER !== 'false') {
    const { startWorker } = require('./workers/operation.worker');
    startWorker();
    console.log('  Operation Worker started');
  } else {
    console.log('  Operation Worker disabled');
  }

  // Start Host Status Worker (stale timeout + port scanner)
  if (process.env.HOST_STATUS_WORKER !== 'false') {
    const hostStatusWorker = require('./workers/host-status.worker');
    hostStatusWorker.startWorker();
    console.log('  Host Status Worker started');
    // Store reference for shutdown
    server._hostStatusWorker = hostStatusWorker;
  } else {
    console.log('  Host Status Worker disabled');
  }

  // Image sync startup recovery (clean stale locks from crashed containers)
  let isSyncMode = process.env.SYNC_ENABLED === 'true';
  try {
    const settingsService2 = require('./services/settings.service');
    const syncSetting = await settingsService2.get('sync_enabled');
    if (syncSetting === 'true') isSyncMode = true;
  } catch {}
  if (isSyncMode) {
    try {
      const imageSyncService = require('./services/image-sync.service');
      await imageSyncService.recoverOnStartup();
      console.log('  Image Sync recovery complete');
    } catch (err) {
      console.warn('  Image Sync recovery skipped:', err.message);
    }

    // Auto-Sync Timer
    try {
      const settingsService = require('./services/settings.service');
      await settingsService.applySyncInterval();
      console.log('  Auto-Sync Timer initialized');
    } catch (err) {
      console.warn('  Auto-Sync Timer init skipped:', err.message);
    }
  }

  // Ensure gui/ symlinks exist (needed for new LINBO client versions)
  try {
    const sanityFs = require('fs');
    const LINBO_DIR_STARTUP = process.env.LINBO_DIR || '/srv/linbo';
    const guiDir = `${LINBO_DIR_STARTUP}/gui`;
    if (!sanityFs.existsSync(guiDir)) sanityFs.mkdirSync(guiDir, { recursive: true });
    const guiArchive = `${LINBO_DIR_STARTUP}/linbo_gui64_7.tar.lz`;
    if (sanityFs.existsSync(guiArchive)) {
      const guiLink = `${guiDir}/linbo_gui64_7.tar.lz`;
      if (!sanityFs.existsSync(guiLink)) sanityFs.symlinkSync(guiArchive, guiLink);
      const md5 = `${guiArchive}.md5`;
      const md5Link = `${guiDir}/linbo_gui64_7.tar.lz.md5`;
      if (sanityFs.existsSync(md5) && !sanityFs.existsSync(md5Link)) sanityFs.symlinkSync(md5, md5Link);
    }
    const iconsDir = `${LINBO_DIR_STARTUP}/icons`;
    const iconsLink = `${guiDir}/icons`;
    if (sanityFs.existsSync(iconsDir) && !sanityFs.existsSync(iconsLink)) {
      sanityFs.symlinkSync(iconsDir, iconsLink);
    }
    console.log('  GUI symlinks: verified');
  } catch (err) {
    console.warn('  GUI symlinks check failed:', err.message);
  }

  // Startup sanity check: verify critical directories exist
  const sanityFs = require('fs');
  const { LINBO_DIR, IMAGES_DIR } = require('./lib/image-path');
  const criticalPaths = [
    { path: LINBO_DIR, desc: 'LINBO root' },
    { path: `${LINBO_DIR}/boot/grub`, desc: 'GRUB config dir' },
    { path: IMAGES_DIR, desc: 'Images dir' },
  ];
  for (const { path: p, desc } of criticalPaths) {
    if (!sanityFs.existsSync(p)) {
      console.warn(`  ⚠ WARNING: ${desc} missing: ${p}`);
    } else {
      console.log(`  ${desc}: ${p} ✓`);
    }
  }

  // Auto-rebuild linbofs64 if init container downloaded fresh boot files
  try {
    const LINBO_DIR_REBUILD = process.env.LINBO_DIR || '/srv/linbo';
    const rebuildMarker = `${LINBO_DIR_REBUILD}/.needs-rebuild`;
    const runningMarker = `${LINBO_DIR_REBUILD}/.needs-rebuild.running`;

    if (sanityFs.existsSync(rebuildMarker)) {
      console.log('  Rebuild marker found — triggering linbofs64 rebuild...');
      // Rename to .running (atomic) — prevents loop but preserves intent on crash
      sanityFs.renameSync(rebuildMarker, runningMarker);

      const linbofsService = require('./services/linbofs.service');
      const { isHostKernelAvailable } = require('./services/linbo-update.service');

      isHostKernelAvailable().then(async (hk) => {
        const opts = {};
        if (hk.available) {
          opts.env = {
            USE_HOST_KERNEL: 'true',
            HOST_MODULES_PATH: hk.modulesPath,
            SKIP_KERNEL_COPY: 'true',
          };
        }
        const result = await linbofsService.updateLinbofs(opts);
        if (result.success) {
          console.log('[AutoRebuild] linbofs64 rebuilt successfully');
          // Preserve host kernel
          if (hk.available) {
            sanityFs.copyFileSync(hk.kernelPath, `${LINBO_DIR_REBUILD}/linbo64`);
            sanityFs.writeFileSync(`${LINBO_DIR_REBUILD}/.host-kernel-version`, hk.kver);
          }
          // Success — remove running marker
          try { sanityFs.unlinkSync(runningMarker); } catch {}
        } else {
          console.error('[AutoRebuild] FAILED:', result.errors);
          // Rename back so next restart retries
          try { sanityFs.renameSync(runningMarker, rebuildMarker); } catch {}
        }
      }).catch(err => {
        console.error('[AutoRebuild] Error:', err.message);
        try { sanityFs.renameSync(runningMarker, rebuildMarker); } catch {}
      });
    } else if (sanityFs.existsSync(runningMarker)) {
      // Previous rebuild was interrupted — retry
      console.log('  Previous rebuild was interrupted — retrying...');
      sanityFs.renameSync(runningMarker, rebuildMarker);
      // Will be picked up on next restart
    }
  } catch (err) {
    console.warn('  Auto-rebuild check failed:', err.message);
  }

  // Start HTTP server
  server.listen(PORT, HOST, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║              LINBO Docker API Server                             ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  REST API:     http://${HOST}:${PORT}/api/v1                          ║
║  WebSocket:    ws://${HOST}:${PORT}/ws                                ║
║  Health:       http://${HOST}:${PORT}/health                          ║
║  Ready:        http://${HOST}:${PORT}/ready                           ║
║                                                                  ║
║  Environment:  ${(process.env.NODE_ENV || 'development').padEnd(45)}║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
    `);
  });
}

// =============================================================================
// Graceful Shutdown
// =============================================================================
async function shutdown(signal) {
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(async () => {
    console.log('HTTP server closed');

    // Stop Host Status Worker
    if (server._hostStatusWorker) {
      server._hostStatusWorker.stopWorker();
      console.log('Host Status Worker stopped');
    }

    // Close terminal sessions
    try {
      const termService = require('./services/terminal.service');
      termService.destroyAll();
      console.log('Terminal sessions closed');
    } catch {}

    // Close Terminal WebSocket connections
    if (server._terminalWss) {
      server._terminalWss.clients.forEach((client) => {
        client.close(1001, 'Server shutting down');
      });
    }

    // Close WebSocket connections
    const wss = websocket.getServer();
    if (wss) {
      wss.clients.forEach((client) => {
        client.close(1001, 'Server shutting down');
      });
      console.log('WebSocket connections closed');
    }

    // Disconnect Redis
    try {
      await redis.disconnect();
      console.log('Redis disconnected');
    } catch (err) {
      console.error('Redis disconnect error:', err.message);
    }

    // Disconnect Prisma (if available)
    if (prisma) {
      try {
        await disconnectPrisma();
        console.log('PostgreSQL disconnected');
      } catch (err) {
        console.error('PostgreSQL disconnect error:', err.message);
      }
    }

    console.log('Graceful shutdown complete');
    process.exit(0);
  });

  // Force shutdown after timeout
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the server
startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Export for testing
module.exports = { app, server };
