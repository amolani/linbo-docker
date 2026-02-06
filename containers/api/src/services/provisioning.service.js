/**
 * LINBO Docker - Host Provisioning Service
 *
 * Manages host provisioning jobs via Redis Streams to the DC Worker.
 * When hosts are created/updated/deleted in Docker, the DC Worker
 * runs linuxmuster-import-devices on the AD DC to sync AD/DNS/DHCP.
 *
 * Mirrors the macct.service.js pattern:
 * - Same stream (linbo:jobs) and consumer group (dc-workers)
 * - Same Operation model for tracking
 * - Slim stream payload; details in Operation.options
 *
 * Gate: DC_PROVISIONING_ENABLED=true (default: false)
 * Dry-Run: DC_PROVISIONING_DRYRUN=true (default: true)
 */

const { prisma } = require('../lib/prisma');
const redis = require('../lib/redis');
const ws = require('../lib/websocket');

// Reuse same stream constants as macct.service.js
const STREAM_NAME = 'linbo:jobs';
const CONSUMER_GROUP = 'dc-workers';
const DLQ_STREAM = 'linbo:jobs:dlq';
const MAX_RETRIES = 3;

// CSV column 0 source: 'room' (default) or 'group'
const CSV_COL0_SOURCE = process.env.CSV_COL0_SOURCE || 'room';

/**
 * Check if provisioning is enabled
 */
function isProvisioningEnabled() {
  return process.env.DC_PROVISIONING_ENABLED === 'true';
}

/**
 * Check if dry-run mode is active
 */
function isDryRunEnabled() {
  return process.env.DC_PROVISIONING_DRYRUN !== 'false';
}

/**
 * Create a host provisioning job
 *
 * @param {object} hostData - Host data for provisioning
 * @param {string} action - 'create' | 'update' | 'delete'
 * @param {object} extraOptions - Additional options (oldHostname, etc.)
 * @returns {object} { operation, queued, message }
 */
async function createProvisionJob(hostData, action, extraOptions = {}) {
  const {
    hostname, macAddress, ipAddress, csvCol0,
    configName, hostId,
  } = hostData;

  // Deduplication: check for existing pending/running job
  const dedup = _buildDedupWhere(action, hostId, hostname, macAddress);
  const existingJob = await prisma.operation.findFirst({ where: dedup });

  if (existingJob) {
    console.log(`[Provision] Job already exists for ${hostname}: ${existingJob.id}`);
    return {
      operation: existingJob,
      queued: false,
      message: 'Job already queued',
    };
  }

  const options = {
    action,
    hostname,
    mac: macAddress,
    ip: ipAddress || '',
    configName: configName || '',
    csvCol0: csvCol0 || '',
    oldHostname: extraOptions.oldHostname || null,
    hostId: hostId || null,
    pxeFlag: configName ? 1 : 0,
    dryRun: isDryRunEnabled(),
    ...extraOptions,
  };

  // Create operation in PostgreSQL
  const operation = await prisma.operation.create({
    data: {
      type: 'provision_host',
      targetHosts: [],
      targetHost: hostname,
      school: 'default-school',
      commands: ['provision_host'],
      options,
      status: 'pending',
      attempt: 0,
    },
  });

  // Publish slim payload to Redis Stream
  await _publishToStream(operation);

  // Broadcast event
  ws.broadcast('provision.job.created', {
    operationId: operation.id,
    hostname,
    action,
    status: 'pending',
  });

  console.log(`[Provision] Created ${action} job for ${hostname}: ${operation.id}`);

  return {
    operation,
    queued: true,
    message: 'Job queued successfully',
  };
}

/**
 * Build deduplication query
 */
function _buildDedupWhere(action, hostId, hostname, macAddress) {
  const base = {
    type: 'provision_host',
    status: { in: ['pending', 'running', 'retrying'] },
  };

  if (action === 'delete') {
    // For delete, hostId may be null - use targetHost + mac
    return {
      ...base,
      targetHost: hostname,
      options: { path: ['action'], equals: action },
    };
  }

  // For create/update: match by action + hostId
  if (hostId) {
    return {
      ...base,
      options: {
        path: ['action'],
        equals: action,
      },
      AND: [
        { options: { path: ['hostId'], equals: hostId } },
      ],
    };
  }

  return {
    ...base,
    targetHost: hostname,
    options: { path: ['action'], equals: action },
  };
}

/**
 * Publish a slim job to the Redis Stream
 */
async function _publishToStream(operation) {
  const client = redis.getClient();

  const jobData = {
    type: 'provision_host',
    operation_id: operation.id,
    action: operation.options.action,
    school: operation.school || 'default-school',
    attempt: String(operation.attempt || 0),
    created_at: operation.createdAt.toISOString(),
  };

  const args = Object.entries(jobData).flat();
  const messageId = await client.xadd(STREAM_NAME, '*', ...args);

  console.log(`[Provision] Published to stream: ${messageId}`);
  return messageId;
}

/**
 * Update provision operation status (called by DC worker via API)
 *
 * Also updates Host.provisionStatus/provisionOpId
 *
 * @param {string} operationId
 * @param {object} update - { status, result, error, attempt }
 */
async function updateProvisionStatus(operationId, update) {
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

  if (result !== undefined) updateData.result = result;
  if (error !== undefined) updateData.error = error;
  if (attempt !== undefined) updateData.attempt = attempt;

  const operation = await prisma.operation.update({
    where: { id: operationId },
    data: updateData,
  });

  // Sync Host.provisionStatus
  const hostId = operation.options?.hostId;
  if (hostId) {
    let hostStatus;
    if (status === 'running') {
      hostStatus = 'running';
    } else if (status === 'completed') {
      // Dry-run completed → keep 'pending' (not 'synced')
      hostStatus = result?.dryRun === true ? 'pending' : 'synced';
    } else if (status === 'failed') {
      hostStatus = 'failed';
    }

    if (hostStatus) {
      try {
        await prisma.host.update({
          where: { id: hostId },
          data: {
            provisionStatus: hostStatus,
            provisionOpId: operationId,
          },
        });
      } catch (err) {
        // P2025: Host deleted - graceful handling
        if (err.code !== 'P2025') throw err;
        console.log(`[Provision] Host ${hostId} already deleted, skipping status update`);
      }
    }
  }

  // Broadcast status change
  ws.broadcast('provision.job.updated', {
    operationId: operation.id,
    hostname: operation.targetHost,
    status: operation.status,
    result: operation.result,
    error: operation.error,
    hostId,
  });

  console.log(`[Provision] Updated operation ${operationId}: ${status}`);

  return operation;
}

/**
 * Retry a failed provision job
 */
async function retryProvisionJob(operationId) {
  const operation = await prisma.operation.findUnique({
    where: { id: operationId },
  });

  if (!operation) {
    throw new Error('Operation not found');
  }

  if (operation.attempt >= MAX_RETRIES) {
    await _moveToDLQ(operation);
    return { success: false, message: 'Max retries exceeded, moved to DLQ' };
  }

  const updated = await prisma.operation.update({
    where: { id: operationId },
    data: {
      status: 'retrying',
      attempt: operation.attempt + 1,
      error: null,
    },
  });

  await _publishToStream(updated);

  ws.broadcast('provision.job.retrying', {
    operationId: updated.id,
    hostname: updated.targetHost,
    attempt: updated.attempt,
  });

  return { success: true, attempt: updated.attempt };
}

/**
 * Move failed job to Dead Letter Queue
 */
async function _moveToDLQ(operation) {
  const client = redis.getClient();

  const dlqData = {
    type: 'provision_host',
    operation_id: operation.id,
    host: operation.targetHost,
    school: operation.school || 'default-school',
    attempt: String(operation.attempt),
    last_error: operation.error || 'Unknown error',
    failed_at: new Date().toISOString(),
  };

  const args = Object.entries(dlqData).flat();
  await client.xadd(DLQ_STREAM, '*', ...args);

  await prisma.operation.update({
    where: { id: operation.id },
    data: {
      status: 'failed',
      error: `Max retries (${MAX_RETRIES}) exceeded. Moved to DLQ.`,
    },
  });

  ws.broadcast('provision.job.failed', {
    operationId: operation.id,
    hostname: operation.targetHost,
    reason: 'Max retries exceeded',
  });

  console.log(`[Provision] Moved to DLQ: ${operation.id}`);
}

/**
 * Sync host provision status directly
 */
async function syncHostProvisionStatus(hostId, opId, status) {
  try {
    await prisma.host.update({
      where: { id: hostId },
      data: {
        provisionStatus: status,
        provisionOpId: opId,
      },
    });
  } catch (err) {
    if (err.code !== 'P2025') throw err;
    console.log(`[Provision] Host ${hostId} not found, skipping status sync`);
  }
}

/**
 * List provision jobs with filters
 */
async function listProvisionJobs(filters = {}) {
  const { status, hostname, page = 1, limit = 50 } = filters;

  const where = { type: 'provision_host' };
  if (status) where.status = status;
  if (hostname) where.targetHost = hostname;

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
      options: op.options,
      result: op.result,
      error: op.error,
      createdAt: op.createdAt,
      startedAt: op.startedAt,
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
 * Get single provision operation
 */
async function getProvisionOperation(operationId) {
  const operation = await prisma.operation.findUnique({
    where: { id: operationId },
  });

  if (!operation || operation.type !== 'provision_host') {
    return null;
  }

  return {
    id: operation.id,
    type: operation.type,
    targetHost: operation.targetHost,
    school: operation.school,
    status: operation.status,
    attempt: operation.attempt,
    options: operation.options,
    result: operation.result,
    error: operation.error,
    createdAt: operation.createdAt,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
  };
}

module.exports = {
  // Gate
  isProvisioningEnabled,
  isDryRunEnabled,

  // Job management
  createProvisionJob,
  updateProvisionStatus,
  retryProvisionJob,
  syncHostProvisionStatus,

  // Queries
  listProvisionJobs,
  getProvisionOperation,

  // Constants (shared with macct)
  STREAM_NAME,
  CONSUMER_GROUP,
  DLQ_STREAM,
  MAX_RETRIES,
  CSV_COL0_SOURCE,
};
