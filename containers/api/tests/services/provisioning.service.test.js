/**
 * LINBO Docker - Provisioning Service Tests
 * Tests for host provisioning via Redis Streams to DC Worker
 */

// Mock dependencies
jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    operation: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    host: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const mockRedisClient = {
  xgroup: jest.fn(),
  xadd: jest.fn(),
  xinfo: jest.fn(),
  xlen: jest.fn(),
};

jest.mock('../../src/lib/redis', () => ({
  getClient: jest.fn(() => mockRedisClient),
}));

jest.mock('../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
}));

const { prisma } = require('../../src/lib/prisma');
const ws = require('../../src/lib/websocket');
const provisioningService = require('../../src/services/provisioning.service');

// Test fixtures
const mockHostData = {
  hostname: 'pc01',
  macAddress: 'aa:bb:cc:dd:ee:ff',
  ipAddress: '10.0.0.100',
  csvCol0: 'lab01',
  configName: 'windows-config',
  hostId: '550e8400-e29b-41d4-a716-446655440099',
};

const mockOperation = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  type: 'provision_host',
  targetHost: 'pc01',
  school: 'default-school',
  status: 'pending',
  attempt: 0,
  commands: ['provision_host'],
  options: {
    action: 'create',
    hostname: 'pc01',
    mac: 'aa:bb:cc:dd:ee:ff',
    ip: '10.0.0.100',
    configName: 'windows-config',
    csvCol0: 'lab01',
    oldHostname: null,
    hostId: '550e8400-e29b-41d4-a716-446655440099',
    pxeFlag: 1,
    dryRun: true,
  },
  result: null,
  error: null,
  createdAt: new Date('2026-02-06T10:00:00Z'),
  startedAt: null,
  completedAt: null,
};

describe('Provisioning Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: provisioning disabled, dry-run on
    delete process.env.DC_PROVISIONING_ENABLED;
    delete process.env.DC_PROVISIONING_DRYRUN;
    delete process.env.CSV_COL0_SOURCE;
  });

  // =========================================================================
  // isProvisioningEnabled
  // =========================================================================
  describe('isProvisioningEnabled', () => {
    test('should return false by default', () => {
      expect(provisioningService.isProvisioningEnabled()).toBe(false);
    });

    test('should return true when DC_PROVISIONING_ENABLED=true', () => {
      process.env.DC_PROVISIONING_ENABLED = 'true';
      expect(provisioningService.isProvisioningEnabled()).toBe(true);
    });

    test('should return false for any value other than "true"', () => {
      process.env.DC_PROVISIONING_ENABLED = 'yes';
      expect(provisioningService.isProvisioningEnabled()).toBe(false);
    });
  });

  // =========================================================================
  // isDryRunEnabled
  // =========================================================================
  describe('isDryRunEnabled', () => {
    test('should return true by default (dry-run ON)', () => {
      expect(provisioningService.isDryRunEnabled()).toBe(true);
    });

    test('should return false when DC_PROVISIONING_DRYRUN=false', () => {
      process.env.DC_PROVISIONING_DRYRUN = 'false';
      expect(provisioningService.isDryRunEnabled()).toBe(false);
    });
  });

  // =========================================================================
  // createProvisionJob
  // =========================================================================
  describe('createProvisionJob', () => {
    test('should create Operation and publish to stream', async () => {
      prisma.operation.findFirst.mockResolvedValue(null); // no duplicate
      prisma.operation.create.mockResolvedValue(mockOperation);
      mockRedisClient.xadd.mockResolvedValue('1234567890-0');

      const result = await provisioningService.createProvisionJob(mockHostData, 'create');

      expect(result.queued).toBe(true);
      expect(result.operation.id).toBe(mockOperation.id);

      // Operation created with correct data
      expect(prisma.operation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'provision_host',
            targetHost: 'pc01',
            status: 'pending',
            options: expect.objectContaining({
              action: 'create',
              hostname: 'pc01',
              mac: 'aa:bb:cc:dd:ee:ff',
              ip: '10.0.0.100',
              configName: 'windows-config',
              csvCol0: 'lab01',
            }),
          }),
        })
      );

      // Published to stream
      expect(mockRedisClient.xadd).toHaveBeenCalled();
      const xaddArgs = mockRedisClient.xadd.mock.calls[0];
      expect(xaddArgs[0]).toBe('linbo:jobs');
      // Verify slim payload
      const payloadEntries = xaddArgs.slice(2);
      const payload = {};
      for (let i = 0; i < payloadEntries.length; i += 2) {
        payload[payloadEntries[i]] = payloadEntries[i + 1];
      }
      expect(payload.type).toBe('provision_host');
      expect(payload.action).toBe('create');
      expect(payload.operation_id).toBe(mockOperation.id);
      // Slim: no hostname, mac, ip in stream payload
      expect(payload.hostname).toBeUndefined();
      expect(payload.mac).toBeUndefined();

      // WebSocket broadcast
      expect(ws.broadcast).toHaveBeenCalledWith('provision.job.created', expect.objectContaining({
        operationId: mockOperation.id,
        hostname: 'pc01',
        action: 'create',
      }));
    });

    test('should deduplicate existing pending jobs', async () => {
      prisma.operation.findFirst.mockResolvedValue(mockOperation);

      const result = await provisioningService.createProvisionJob(mockHostData, 'create');

      expect(result.queued).toBe(false);
      expect(result.message).toBe('Job already queued');
      expect(prisma.operation.create).not.toHaveBeenCalled();
      expect(mockRedisClient.xadd).not.toHaveBeenCalled();
    });

    test('should store frozen snapshot for delete action', async () => {
      prisma.operation.findFirst.mockResolvedValue(null);
      prisma.operation.create.mockResolvedValue({
        ...mockOperation,
        options: { ...mockOperation.options, action: 'delete' },
      });
      mockRedisClient.xadd.mockResolvedValue('1234567890-0');

      await provisioningService.createProvisionJob(mockHostData, 'delete');

      expect(prisma.operation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            options: expect.objectContaining({
              action: 'delete',
              hostname: 'pc01',
              mac: 'aa:bb:cc:dd:ee:ff',
              ip: '10.0.0.100',
            }),
          }),
        })
      );
    });

    test('should set dryRun from environment', async () => {
      process.env.DC_PROVISIONING_DRYRUN = 'false';
      prisma.operation.findFirst.mockResolvedValue(null);
      prisma.operation.create.mockResolvedValue({
        ...mockOperation,
        options: { ...mockOperation.options, dryRun: false },
      });
      mockRedisClient.xadd.mockResolvedValue('1234567890-0');

      await provisioningService.createProvisionJob(mockHostData, 'create');

      expect(prisma.operation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            options: expect.objectContaining({
              dryRun: false,
            }),
          }),
        })
      );
    });

    test('should pass oldHostname in extra options', async () => {
      prisma.operation.findFirst.mockResolvedValue(null);
      prisma.operation.create.mockResolvedValue(mockOperation);
      mockRedisClient.xadd.mockResolvedValue('1234567890-0');

      await provisioningService.createProvisionJob(
        mockHostData, 'update', { oldHostname: 'oldpc01' }
      );

      expect(prisma.operation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            options: expect.objectContaining({
              oldHostname: 'oldpc01',
              action: 'update',
            }),
          }),
        })
      );
    });

    test('should set pxeFlag=0 when no configName', async () => {
      prisma.operation.findFirst.mockResolvedValue(null);
      prisma.operation.create.mockResolvedValue(mockOperation);
      mockRedisClient.xadd.mockResolvedValue('1234567890-0');

      await provisioningService.createProvisionJob(
        { ...mockHostData, configName: null }, 'create'
      );

      expect(prisma.operation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            options: expect.objectContaining({
              pxeFlag: 0,
              configName: '',
            }),
          }),
        })
      );
    });
  });

  // =========================================================================
  // updateProvisionStatus
  // =========================================================================
  describe('updateProvisionStatus', () => {
    test('should update Operation timestamps on running', async () => {
      prisma.operation.update.mockResolvedValue({
        ...mockOperation,
        status: 'running',
        options: mockOperation.options,
      });
      prisma.host.update.mockResolvedValue({});

      await provisioningService.updateProvisionStatus(mockOperation.id, {
        status: 'running',
      });

      expect(prisma.operation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'running',
            startedAt: expect.any(Date),
          }),
        })
      );
    });

    test('should set Host.provisionStatus to synced on completed', async () => {
      prisma.operation.update.mockResolvedValue({
        ...mockOperation,
        status: 'completed',
        options: mockOperation.options,
      });
      prisma.host.update.mockResolvedValue({});

      await provisioningService.updateProvisionStatus(mockOperation.id, {
        status: 'completed',
        result: { verify: {} },
      });

      expect(prisma.host.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockOperation.options.hostId },
          data: expect.objectContaining({
            provisionStatus: 'synced',
            provisionOpId: mockOperation.id,
          }),
        })
      );
    });

    test('should keep Host pending on dry-run completed', async () => {
      prisma.operation.update.mockResolvedValue({
        ...mockOperation,
        status: 'completed',
        options: mockOperation.options,
      });
      prisma.host.update.mockResolvedValue({});

      await provisioningService.updateProvisionStatus(mockOperation.id, {
        status: 'completed',
        result: { dryRun: true, mergeStats: {} },
      });

      expect(prisma.host.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provisionStatus: 'pending',
          }),
        })
      );
    });

    test('should set Host.provisionStatus to failed on failure', async () => {
      prisma.operation.update.mockResolvedValue({
        ...mockOperation,
        status: 'failed',
        options: mockOperation.options,
      });
      prisma.host.update.mockResolvedValue({});

      await provisioningService.updateProvisionStatus(mockOperation.id, {
        status: 'failed',
        error: 'Verify failed',
      });

      expect(prisma.host.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provisionStatus: 'failed',
          }),
        })
      );
    });

    test('should handle deleted host gracefully (P2025)', async () => {
      prisma.operation.update.mockResolvedValue({
        ...mockOperation,
        status: 'completed',
        options: mockOperation.options,
      });
      prisma.host.update.mockRejectedValue({ code: 'P2025' });

      // Should not throw
      await expect(
        provisioningService.updateProvisionStatus(mockOperation.id, {
          status: 'completed',
          result: {},
        })
      ).resolves.toBeDefined();
    });

    test('should broadcast provision.job.updated', async () => {
      prisma.operation.update.mockResolvedValue({
        ...mockOperation,
        status: 'running',
        options: mockOperation.options,
      });
      prisma.host.update.mockResolvedValue({});

      await provisioningService.updateProvisionStatus(mockOperation.id, {
        status: 'running',
      });

      expect(ws.broadcast).toHaveBeenCalledWith('provision.job.updated', expect.objectContaining({
        operationId: mockOperation.id,
        status: 'running',
      }));
    });
  });

  // =========================================================================
  // retryProvisionJob
  // =========================================================================
  describe('retryProvisionJob', () => {
    test('should re-publish with incremented attempt', async () => {
      prisma.operation.findUnique.mockResolvedValue({
        ...mockOperation,
        status: 'failed',
        attempt: 1,
      });
      prisma.operation.update.mockResolvedValue({
        ...mockOperation,
        status: 'retrying',
        attempt: 2,
        createdAt: new Date(),
      });
      mockRedisClient.xadd.mockResolvedValue('1234567890-0');

      const result = await provisioningService.retryProvisionJob(mockOperation.id);

      expect(result.success).toBe(true);
      expect(result.attempt).toBe(2);
      expect(mockRedisClient.xadd).toHaveBeenCalled();
    });

    test('should move to DLQ after MAX_RETRIES', async () => {
      prisma.operation.findUnique.mockResolvedValue({
        ...mockOperation,
        status: 'failed',
        attempt: 3,
      });
      prisma.operation.update.mockResolvedValue({});
      mockRedisClient.xadd.mockResolvedValue('1234567890-0');

      const result = await provisioningService.retryProvisionJob(mockOperation.id);

      expect(result.success).toBe(false);
      expect(result.message).toContain('DLQ');
      // Should write to DLQ stream
      expect(mockRedisClient.xadd).toHaveBeenCalledWith(
        'linbo:jobs:dlq',
        '*',
        'type', 'provision_host',
        'operation_id', mockOperation.id,
        'host', mockOperation.targetHost,
        'school', expect.any(String),
        'attempt', expect.any(String),
        'last_error', expect.any(String),
        'failed_at', expect.any(String),
      );
    });

    test('should throw if operation not found', async () => {
      prisma.operation.findUnique.mockResolvedValue(null);

      await expect(
        provisioningService.retryProvisionJob('nonexistent')
      ).rejects.toThrow('Operation not found');
    });
  });

  // =========================================================================
  // syncHostProvisionStatus
  // =========================================================================
  describe('syncHostProvisionStatus', () => {
    test('should update host fields', async () => {
      prisma.host.update.mockResolvedValue({});

      await provisioningService.syncHostProvisionStatus(
        mockHostData.hostId, mockOperation.id, 'pending'
      );

      expect(prisma.host.update).toHaveBeenCalledWith({
        where: { id: mockHostData.hostId },
        data: {
          provisionStatus: 'pending',
          provisionOpId: mockOperation.id,
        },
      });
    });

    test('should handle missing host gracefully', async () => {
      prisma.host.update.mockRejectedValue({ code: 'P2025' });

      // Should not throw
      await expect(
        provisioningService.syncHostProvisionStatus('gone', 'op', 'pending')
      ).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // listProvisionJobs
  // =========================================================================
  describe('listProvisionJobs', () => {
    test('should return paginated list filtered by type', async () => {
      prisma.operation.findMany.mockResolvedValue([mockOperation]);
      prisma.operation.count.mockResolvedValue(1);

      const result = await provisioningService.listProvisionJobs({
        page: 1,
        limit: 50,
      });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(prisma.operation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { type: 'provision_host' },
        })
      );
    });

    test('should filter by status and hostname', async () => {
      prisma.operation.findMany.mockResolvedValue([]);
      prisma.operation.count.mockResolvedValue(0);

      await provisioningService.listProvisionJobs({
        status: 'failed',
        hostname: 'pc01',
      });

      expect(prisma.operation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            type: 'provision_host',
            status: 'failed',
            targetHost: 'pc01',
          },
        })
      );
    });
  });

  // =========================================================================
  // getProvisionOperation
  // =========================================================================
  describe('getProvisionOperation', () => {
    test('should return operation details', async () => {
      prisma.operation.findUnique.mockResolvedValue(mockOperation);

      const result = await provisioningService.getProvisionOperation(mockOperation.id);

      expect(result).toBeTruthy();
      expect(result.id).toBe(mockOperation.id);
      expect(result.type).toBe('provision_host');
    });

    test('should return null for non-provision operation', async () => {
      prisma.operation.findUnique.mockResolvedValue({
        ...mockOperation,
        type: 'macct_repair',
      });

      const result = await provisioningService.getProvisionOperation(mockOperation.id);
      expect(result).toBeNull();
    });

    test('should return null for non-existent operation', async () => {
      prisma.operation.findUnique.mockResolvedValue(null);

      const result = await provisioningService.getProvisionOperation('nonexistent');
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================
  describe('Edge Cases', () => {
    test('should handle host with no IP', async () => {
      prisma.operation.findFirst.mockResolvedValue(null);
      prisma.operation.create.mockResolvedValue(mockOperation);
      mockRedisClient.xadd.mockResolvedValue('1234567890-0');

      await provisioningService.createProvisionJob(
        { ...mockHostData, ipAddress: null }, 'create'
      );

      expect(prisma.operation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            options: expect.objectContaining({
              ip: '',
            }),
          }),
        })
      );
    });

    test('should handle host with no config (pxeFlag=0)', async () => {
      prisma.operation.findFirst.mockResolvedValue(null);
      prisma.operation.create.mockResolvedValue(mockOperation);
      mockRedisClient.xadd.mockResolvedValue('1234567890-0');

      await provisioningService.createProvisionJob(
        { ...mockHostData, configName: '' }, 'create'
      );

      expect(prisma.operation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            options: expect.objectContaining({
              pxeFlag: 0,
            }),
          }),
        })
      );
    });
  });
});
