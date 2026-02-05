/**
 * LINBO Docker - Operation Worker
 * Background worker that processes pending operations
 */

const { prisma } = require('../lib/prisma');
const sshService = require('../services/ssh.service');
const ws = require('../lib/websocket');

const POLL_INTERVAL = parseInt(process.env.OPERATION_POLL_INTERVAL) || 5000;
const MAX_CONCURRENT_SESSIONS = parseInt(process.env.MAX_CONCURRENT_SESSIONS) || 5;

let isRunning = false;
let isPaused = false;

/**
 * Start the operation worker
 */
function startWorker() {
  if (isRunning) {
    console.log('[OperationWorker] Already running');
    return;
  }

  isRunning = true;
  console.log('[OperationWorker] Started');
  console.log(`[OperationWorker] Poll interval: ${POLL_INTERVAL}ms`);
  console.log(`[OperationWorker] Max concurrent sessions: ${MAX_CONCURRENT_SESSIONS}`);

  pollOperations();
}

/**
 * Stop the operation worker
 */
function stopWorker() {
  isRunning = false;
  console.log('[OperationWorker] Stopped');
}

/**
 * Pause the operation worker
 */
function pauseWorker() {
  isPaused = true;
  console.log('[OperationWorker] Paused');
}

/**
 * Resume the operation worker
 */
function resumeWorker() {
  isPaused = false;
  console.log('[OperationWorker] Resumed');
}

/**
 * Get worker status
 */
function getStatus() {
  return {
    running: isRunning,
    paused: isPaused,
    pollInterval: POLL_INTERVAL,
    maxConcurrentSessions: MAX_CONCURRENT_SESSIONS,
  };
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main polling loop
 */
async function pollOperations() {
  while (isRunning) {
    if (!isPaused) {
      try {
        await processNextOperation();
      } catch (error) {
        console.error('[OperationWorker] Error:', error.message);
      }
    }
    await sleep(POLL_INTERVAL);
  }
}

/**
 * Process the next pending operation
 */
async function processNextOperation() {
  // Find the oldest pending operation
  const operation = await prisma.operation.findFirst({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
  });

  if (!operation) {
    return; // No pending operations
  }

  console.log(`[OperationWorker] Processing operation ${operation.id}`);

  // Update status to 'running'
  await prisma.operation.update({
    where: { id: operation.id },
    data: {
      status: 'running',
      startedAt: new Date(),
    },
  });

  // Create sessions for each target host
  const hosts = await prisma.host.findMany({
    where: { id: { in: operation.targetHosts } },
  });

  // Create sessions for all target hosts
  const sessions = [];
  for (const host of hosts) {
    const session = await prisma.session.create({
      data: {
        operationId: operation.id,
        hostId: host.id,
        hostname: host.hostname,
        status: 'pending',
        progress: 0,
      },
    });
    sessions.push({ session, host });
  }

  // Broadcast operation started
  ws.broadcast('operation.running', {
    operationId: operation.id,
    commands: operation.commands,
    totalSessions: sessions.length,
  });

  // Process sessions (with concurrency limit)
  let completed = 0;
  let failed = 0;

  // Process in batches
  for (let i = 0; i < sessions.length; i += MAX_CONCURRENT_SESSIONS) {
    const batch = sessions.slice(i, i + MAX_CONCURRENT_SESSIONS);

    // Process batch in parallel
    const results = await Promise.allSettled(
      batch.map(({ session, host }) =>
        processSession(operation, session, host)
      )
    );

    // Count results
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success) {
        completed++;
      } else {
        failed++;
      }
    }

    // Update operation progress
    const progress = Math.round(((completed + failed) / sessions.length) * 100);
    await prisma.operation.update({
      where: { id: operation.id },
      data: { progress },
    });

    ws.broadcast('operation.progress', {
      operationId: operation.id,
      progress,
      completed,
      failed,
      total: sessions.length,
    });
  }

  // Complete the operation
  const finalStatus = failed === 0 ? 'completed' : 'completed_with_errors';
  await prisma.operation.update({
    where: { id: operation.id },
    data: {
      status: finalStatus,
      completedAt: new Date(),
      progress: 100,
      stats: {
        total: sessions.length,
        completed,
        failed,
      },
    },
  });

  ws.broadcast('operation.completed', {
    operationId: operation.id,
    status: finalStatus,
    stats: { total: sessions.length, completed, failed },
  });

  console.log(`[OperationWorker] Operation ${operation.id} completed: ${completed}/${sessions.length} successful`);
}

/**
 * Process a single session (host)
 */
async function processSession(operation, session, host) {
  if (!host.ipAddress) {
    const error = 'Host has no IP address';
    await failSession(session.id, error);
    return { success: false, error };
  }

  // Update session to 'running'
  await prisma.session.update({
    where: { id: session.id },
    data: {
      status: 'running',
      startedAt: new Date(),
    },
  });

  ws.broadcast('session.running', {
    operationId: operation.id,
    sessionId: session.id,
    hostId: host.id,
    hostname: host.hostname,
  });

  // Update host status
  await prisma.host.update({
    where: { id: host.id },
    data: { status: 'busy' },
  });

  try {
    // Execute each command
    for (const command of operation.commands) {
      console.log(`[OperationWorker] Executing '${command}' on ${host.hostname} (${host.ipAddress})`);

      const result = await sshService.executeLinboCommand(
        host.ipAddress,
        command,
        operation.options || {}
      );

      if (result.code !== 0) {
        throw new Error(`Command '${command}' failed: ${result.stderr || result.stdout}`);
      }

      console.log(`[OperationWorker] Command '${command}' completed on ${host.hostname}`);
    }

    // Success
    await prisma.session.update({
      where: { id: session.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        progress: 100,
      },
    });

    // Update host status based on operation type
    const lastCommand = operation.commands[operation.commands.length - 1];
    let newStatus = 'online';
    if (lastCommand === 'sync' || lastCommand === 'initcache') {
      newStatus = 'syncing';
    } else if (lastCommand === 'start') {
      newStatus = 'booting';
    } else if (lastCommand === 'shutdown' || lastCommand === 'halt') {
      newStatus = 'offline';
    }

    await prisma.host.update({
      where: { id: host.id },
      data: { status: newStatus, lastSeen: new Date() },
    });

    ws.broadcast('session.completed', {
      operationId: operation.id,
      sessionId: session.id,
      hostId: host.id,
      hostname: host.hostname,
    });

    ws.broadcast('host.status.changed', {
      hostId: host.id,
      hostname: host.hostname,
      status: newStatus,
    });

    return { success: true };
  } catch (error) {
    console.error(`[OperationWorker] Session failed for ${host.hostname}:`, error.message);

    await failSession(session.id, error.message);

    // Reset host status
    await prisma.host.update({
      where: { id: host.id },
      data: { status: 'error', lastSeen: new Date() },
    });

    ws.broadcast('session.failed', {
      operationId: operation.id,
      sessionId: session.id,
      hostId: host.id,
      hostname: host.hostname,
      error: error.message,
    });

    ws.broadcast('host.status.changed', {
      hostId: host.id,
      hostname: host.hostname,
      status: 'error',
    });

    return { success: false, error: error.message };
  }
}

/**
 * Mark a session as failed
 */
async function failSession(sessionId, errorMessage) {
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      status: 'failed',
      completedAt: new Date(),
      logFile: errorMessage, // Using logFile to store error for now
    },
  });
}

/**
 * Cancel an operation
 */
async function cancelOperation(operationId) {
  const operation = await prisma.operation.findUnique({
    where: { id: operationId },
  });

  if (!operation) {
    throw new Error('Operation not found');
  }

  if (operation.status === 'completed' || operation.status === 'cancelled') {
    throw new Error('Operation already finished');
  }

  // Update operation status
  await prisma.operation.update({
    where: { id: operationId },
    data: {
      status: 'cancelled',
      completedAt: new Date(),
    },
  });

  // Cancel pending sessions
  await prisma.session.updateMany({
    where: {
      operationId,
      status: 'pending',
    },
    data: {
      status: 'cancelled',
      completedAt: new Date(),
    },
  });

  ws.broadcast('operation.cancelled', {
    operationId,
  });

  console.log(`[OperationWorker] Operation ${operationId} cancelled`);

  return { success: true };
}

/**
 * Retry a failed operation
 */
async function retryOperation(operationId) {
  const operation = await prisma.operation.findUnique({
    where: { id: operationId },
    include: {
      sessions: {
        where: { status: 'failed' },
      },
    },
  });

  if (!operation) {
    throw new Error('Operation not found');
  }

  if (operation.sessions.length === 0) {
    throw new Error('No failed sessions to retry');
  }

  // Create new operation with failed hosts
  const failedHostIds = operation.sessions.map(s => s.hostId).filter(Boolean);

  const newOperation = await prisma.operation.create({
    data: {
      targetHosts: failedHostIds,
      commands: operation.commands,
      options: operation.options,
      status: 'pending',
    },
  });

  console.log(`[OperationWorker] Created retry operation ${newOperation.id} for ${failedHostIds.length} hosts`);

  return newOperation;
}

module.exports = {
  startWorker,
  stopWorker,
  pauseWorker,
  resumeWorker,
  getStatus,
  cancelOperation,
  retryOperation,
};
