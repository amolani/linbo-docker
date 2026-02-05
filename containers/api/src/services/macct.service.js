/**
 * LINBO Docker - Machine Account (macct) Service
 *
 * Manages machine account password repair jobs via Redis Streams.
 * Jobs are consumed by a worker running on the AD DC that has
 * direct access to sam.ldb.
 *
 * Architecture:
 * - API (Producer): Creates jobs in PostgreSQL + Redis Stream
 * - Redis Stream: linbo:jobs with consumer group dc-workers
 * - DC Worker (Consumer): Executes repair_macct.py locally
 */

const { prisma } = require('../lib/prisma');
const redis = require('../lib/redis');
const ws = require('../lib/websocket');

// Stream configuration
const STREAM_NAME = 'linbo:jobs';
const CONSUMER_GROUP = 'dc-workers';
const DLQ_STREAM = 'linbo:jobs:dlq';
const MAX_RETRIES = 3;

/**
 * Initialize Redis consumer group for DC workers
 * Creates the group if it doesn't exist
 */
async function initializeConsumerGroup() {
  const client = redis.getClient();

  try {
    // Create consumer group (MKSTREAM creates the stream if it doesn't exist)
    await client.xgroup('CREATE', STREAM_NAME, CONSUMER_GROUP, '$', 'MKSTREAM');
    console.log(`[Macct] Created consumer group: ${CONSUMER_GROUP}`);
  } catch (error) {
    // Group already exists - this is fine
    if (error.message.includes('BUSYGROUP')) {
      console.log(`[Macct] Consumer group ${CONSUMER_GROUP} already exists`);
    } else {
      throw error;
    }
  }
}

/**
 * Create a machine account repair job
 *
 * @param {string} hostname - Target host name
 * @param {string} school - School identifier (default: 'default-school')
 * @param {object} options - Additional options
 * @returns {object} Created operation
 */
async function createMacctRepairJob(hostname, school = 'default-school', options = {}) {
  // Check for existing pending/running job for this host
  const existingJob = await prisma.operation.findFirst({
    where: {
      type: 'macct_repair',
      targetHost: hostname,
      status: { in: ['pending', 'running', 'retrying'] },
    },
  });

  if (existingJob) {
    console.log(`[Macct] Job already exists for ${hostname}: ${existingJob.id}`);
    return {
      operation: existingJob,
      queued: false,
      message: 'Job already queued',
    };
  }

  // Create operation in PostgreSQL
  const operation = await prisma.operation.create({
    data: {
      type: 'macct_repair',
      targetHosts: [],  // Required field, empty for macct operations
      targetHost: hostname,
      school: school,
      commands: ['macct_repair'],
      options: options,
      status: 'pending',
      attempt: 0,
    },
  });

  // Publish job to Redis Stream
  await publishToStream(operation);

  // Broadcast event
  ws.broadcast('macct.job.created', {
    operationId: operation.id,
    hostname: hostname,
    school: school,
    status: 'pending',
  });

  console.log(`[Macct] Created job for ${hostname}: ${operation.id}`);

  return {
    operation,
    queued: true,
    message: 'Job queued successfully',
  };
}

/**
 * Publish a job to the Redis Stream
 *
 * @param {object} operation - Operation from database
 */
async function publishToStream(operation) {
  const client = redis.getClient();

  const jobData = {
    type: 'macct_repair',
    operation_id: operation.id,
    host: operation.targetHost,
    school: operation.school || 'default-school',
    attempt: String(operation.attempt || 0),
    created_at: operation.createdAt.toISOString(),
  };

  // Convert to flat array for XADD
  const args = Object.entries(jobData).flat();

  const messageId = await client.xadd(STREAM_NAME, '*', ...args);

  console.log(`[Macct] Published to stream: ${messageId}`);

  return messageId;
}

/**
 * Update operation status (called by DC worker via API)
 *
 * @param {string} operationId - Operation UUID
 * @param {object} update - Status update data
 */
async function updateOperationStatus(operationId, update) {
  const { status, result, error, attempt } = update;

  const updateData = {};

  if (status) {
    updateData.status = status;

    if (status === 'running') {
      updateData.startedAt = new Date();
    }

    if (['completed', 'failed'].includes(status)) {
      updateData.completedAt = new Date();
    }
  }

  if (result !== undefined) {
    updateData.result = result;
  }

  if (error !== undefined) {
    updateData.error = error;
  }

  if (attempt !== undefined) {
    updateData.attempt = attempt;
  }

  const operation = await prisma.operation.update({
    where: { id: operationId },
    data: updateData,
  });

  // Broadcast status change
  ws.broadcast('macct.job.updated', {
    operationId: operation.id,
    hostname: operation.targetHost,
    status: operation.status,
    result: operation.result,
    error: operation.error,
  });

  console.log(`[Macct] Updated operation ${operationId}: ${status}`);

  return operation;
}

/**
 * Retry a failed job
 *
 * @param {string} operationId - Operation UUID
 */
async function retryJob(operationId) {
  const operation = await prisma.operation.findUnique({
    where: { id: operationId },
  });

  if (!operation) {
    throw new Error('Operation not found');
  }

  if (operation.attempt >= MAX_RETRIES) {
    // Move to DLQ
    await moveToDLQ(operation);
    return { success: false, message: 'Max retries exceeded, moved to DLQ' };
  }

  // Update attempt counter and status
  const updated = await prisma.operation.update({
    where: { id: operationId },
    data: {
      status: 'retrying',
      attempt: operation.attempt + 1,
      error: null,
    },
  });

  // Re-publish to stream
  await publishToStream(updated);

  ws.broadcast('macct.job.retrying', {
    operationId: updated.id,
    hostname: updated.targetHost,
    attempt: updated.attempt,
  });

  return { success: true, attempt: updated.attempt };
}

/**
 * Move failed job to Dead Letter Queue
 *
 * @param {object} operation - Failed operation
 */
async function moveToDLQ(operation) {
  const client = redis.getClient();

  const dlqData = {
    type: 'macct_repair',
    operation_id: operation.id,
    host: operation.targetHost,
    school: operation.school || 'default-school',
    attempt: String(operation.attempt),
    last_error: operation.error || 'Unknown error',
    failed_at: new Date().toISOString(),
  };

  const args = Object.entries(dlqData).flat();
  await client.xadd(DLQ_STREAM, '*', ...args);

  // Update operation status
  await prisma.operation.update({
    where: { id: operation.id },
    data: {
      status: 'failed',
      error: `Max retries (${MAX_RETRIES}) exceeded. Moved to DLQ.`,
    },
  });

  ws.broadcast('macct.job.failed', {
    operationId: operation.id,
    hostname: operation.targetHost,
    reason: 'Max retries exceeded',
  });

  console.log(`[Macct] Moved to DLQ: ${operation.id}`);
}

/**
 * Get macct operation status
 *
 * @param {string} operationId - Operation UUID
 */
async function getOperationStatus(operationId) {
  const operation = await prisma.operation.findUnique({
    where: { id: operationId },
  });

  if (!operation) {
    return null;
  }

  return {
    id: operation.id,
    type: operation.type,
    targetHost: operation.targetHost,
    school: operation.school,
    status: operation.status,
    attempt: operation.attempt,
    result: operation.result,
    error: operation.error,
    createdAt: operation.createdAt,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
  };
}

/**
 * List macct jobs with filters
 *
 * @param {object} filters - Query filters
 */
async function listMacctJobs(filters = {}) {
  const { status, hostname, school, page = 1, limit = 50 } = filters;

  const where = { type: 'macct_repair' };

  if (status) where.status = status;
  if (hostname) where.targetHost = hostname;
  if (school) where.school = school;

  const [operations, total] = await Promise.all([
    prisma.operation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: parseInt(limit, 10),
    }),
    prisma.operation.count({ where }),
  ]);

  return {
    data: operations.map(op => ({
      id: op.id,
      targetHost: op.targetHost,
      school: op.school,
      status: op.status,
      attempt: op.attempt,
      result: op.result,
      error: op.error,
      createdAt: op.createdAt,
      completedAt: op.completedAt,
    })),
    pagination: {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get stream info for monitoring
 */
async function getStreamInfo() {
  const client = redis.getClient();

  try {
    const [streamInfo, groupInfo, dlqLen] = await Promise.all([
      client.xinfo('STREAM', STREAM_NAME).catch(() => null),
      client.xinfo('GROUPS', STREAM_NAME).catch(() => []),
      client.xlen(DLQ_STREAM).catch(() => 0),
    ]);

    // Parse stream info
    const streamData = {};
    if (streamInfo) {
      for (let i = 0; i < streamInfo.length; i += 2) {
        streamData[streamInfo[i]] = streamInfo[i + 1];
      }
    }

    // Parse group info
    const groups = groupInfo.map(group => {
      const data = {};
      for (let i = 0; i < group.length; i += 2) {
        data[group[i]] = group[i + 1];
      }
      return data;
    });

    return {
      stream: {
        name: STREAM_NAME,
        length: streamData.length || 0,
        firstEntry: streamData['first-entry'],
        lastEntry: streamData['last-entry'],
      },
      consumerGroups: groups,
      dlq: {
        name: DLQ_STREAM,
        length: dlqLen,
      },
    };
  } catch (error) {
    console.error('[Macct] Error getting stream info:', error.message);
    return { error: error.message };
  }
}

/**
 * Get pending jobs from consumer group
 */
async function getPendingJobs() {
  const client = redis.getClient();

  try {
    const pending = await client.xpending(STREAM_NAME, CONSUMER_GROUP);

    if (!pending || pending[0] === 0) {
      return { count: 0, jobs: [] };
    }

    // Get details of pending messages
    const details = await client.xpending(
      STREAM_NAME,
      CONSUMER_GROUP,
      '-', '+',
      Math.min(pending[0], 100)
    );

    return {
      count: pending[0],
      minId: pending[1],
      maxId: pending[2],
      consumers: pending[3],
      jobs: details.map(job => ({
        id: job[0],
        consumer: job[1],
        idleTime: job[2],
        deliveryCount: job[3],
      })),
    };
  } catch (error) {
    console.error('[Macct] Error getting pending jobs:', error.message);
    return { error: error.message };
  }
}

/**
 * Claim stuck jobs (jobs that haven't been processed for too long)
 * This allows a new worker to take over stuck jobs
 *
 * @param {string} consumerName - Name of consumer claiming the jobs
 * @param {number} minIdleTime - Minimum idle time in ms (default: 5 minutes)
 */
async function claimStuckJobs(consumerName, minIdleTime = 300000) {
  const client = redis.getClient();

  try {
    const claimed = await client.xautoclaim(
      STREAM_NAME,
      CONSUMER_GROUP,
      consumerName,
      minIdleTime,
      '0-0',
      'COUNT', 10
    );

    return {
      claimed: claimed[1] || [],
      deletedIds: claimed[2] || [],
    };
  } catch (error) {
    console.error('[Macct] Error claiming stuck jobs:', error.message);
    return { error: error.message };
  }
}

module.exports = {
  // Initialization
  initializeConsumerGroup,

  // Job management
  createMacctRepairJob,
  updateOperationStatus,
  retryJob,

  // Queries
  getOperationStatus,
  listMacctJobs,

  // Stream monitoring
  getStreamInfo,
  getPendingJobs,
  claimStuckJobs,

  // Constants
  STREAM_NAME,
  CONSUMER_GROUP,
  DLQ_STREAM,
  MAX_RETRIES,
};
