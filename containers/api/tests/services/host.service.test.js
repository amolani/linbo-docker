/**
 * LINBO Docker - Host Service Tests
 * Tests für Host-Management Business Logic
 */

// Mock dependencies
jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    host: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    session: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('../../src/lib/redis', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  delPattern: jest.fn(),
}));

jest.mock('../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
}));

const { prisma } = require('../../src/lib/prisma');
const redis = require('../../src/lib/redis');
const ws = require('../../src/lib/websocket');
const hostService = require('../../src/services/host.service');

// Test fixtures
const mockHost = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  hostname: 'pc-r101-01',
  macAddress: 'aa:bb:cc:dd:ee:ff',
  ipAddress: '10.0.0.101',
  status: 'online',
  lastSeen: new Date(),
  room: { id: 'room-1', name: 'Room 101' },
  group: { id: 'group-1', name: 'win11_efi_sata' },
  config: { id: 'config-1', name: 'win11_efi_sata' },
};

const mockHostWithConfig = {
  ...mockHost,
  config: {
    id: 'config-1',
    name: 'win11_efi_sata',
    partitions: [
      { device: '/dev/sda1', position: 1 },
    ],
    osEntries: [
      { name: 'Windows 11', position: 1 },
    ],
  },
  group: {
    id: 'group-1',
    name: 'win11_efi_sata',
    defaultConfig: null,
  },
};

describe('Host Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getHostById', () => {
    test('should return cached host if available', async () => {
      redis.get.mockResolvedValue(mockHost);

      const result = await hostService.getHostById(mockHost.id);

      expect(result).toEqual(mockHost);
      expect(redis.get).toHaveBeenCalledWith(`host:${mockHost.id}`);
      expect(prisma.host.findUnique).not.toHaveBeenCalled();
    });

    test('should fetch from database if not cached', async () => {
      redis.get.mockResolvedValue(null);
      prisma.host.findUnique.mockResolvedValue(mockHost);

      const result = await hostService.getHostById(mockHost.id);

      expect(result).toEqual(mockHost);
      expect(prisma.host.findUnique).toHaveBeenCalledWith({
        where: { id: mockHost.id },
        include: expect.any(Object),
      });
      expect(redis.set).toHaveBeenCalledWith(`host:${mockHost.id}`, mockHost, 60);
    });

    test('should not cache null result', async () => {
      redis.get.mockResolvedValue(null);
      prisma.host.findUnique.mockResolvedValue(null);

      const result = await hostService.getHostById('non-existent');

      expect(result).toBeNull();
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('getHostByHostname', () => {
    test('should return cached host by hostname', async () => {
      redis.get.mockResolvedValue(mockHost);

      const result = await hostService.getHostByHostname('pc-r101-01');

      expect(result).toEqual(mockHost);
      expect(redis.get).toHaveBeenCalledWith('host:hostname:pc-r101-01');
    });

    test('should fetch from database if not cached', async () => {
      redis.get.mockResolvedValue(null);
      prisma.host.findUnique.mockResolvedValue(mockHost);

      const result = await hostService.getHostByHostname('pc-r101-01');

      expect(result).toEqual(mockHost);
      expect(prisma.host.findUnique).toHaveBeenCalledWith({
        where: { hostname: 'pc-r101-01' },
        include: expect.any(Object),
      });
    });
  });

  describe('getHostByMac', () => {
    test('should normalize MAC address and search', async () => {
      redis.get.mockResolvedValue(null);
      prisma.host.findFirst.mockResolvedValue(mockHost);

      await hostService.getHostByMac('AA-BB-CC-DD-EE-FF');

      expect(redis.get).toHaveBeenCalledWith('host:mac:aa:bb:cc:dd:ee:ff');
      expect(prisma.host.findFirst).toHaveBeenCalledWith({
        where: { macAddress: { equals: 'aa:bb:cc:dd:ee:ff', mode: 'insensitive' } },
        include: expect.any(Object),
      });
    });

    test('should handle MAC with colons', async () => {
      redis.get.mockResolvedValue(null);
      prisma.host.findFirst.mockResolvedValue(mockHost);

      await hostService.getHostByMac('aa:bb:cc:dd:ee:ff');

      expect(redis.get).toHaveBeenCalledWith('host:mac:aa:bb:cc:dd:ee:ff');
    });
  });

  describe('updateHostStatus', () => {
    test('should update status and broadcast event', async () => {
      prisma.host.update.mockResolvedValue({
        ...mockHost,
        status: 'syncing',
        lastSeen: new Date(),
      });

      const result = await hostService.updateHostStatus(mockHost.id, 'syncing');

      expect(prisma.host.update).toHaveBeenCalledWith({
        where: { id: mockHost.id },
        data: expect.objectContaining({
          status: 'syncing',
          lastSeen: expect.any(Date),
        }),
      });

      expect(redis.del).toHaveBeenCalled();
      expect(ws.broadcast).toHaveBeenCalledWith('host.status.changed', expect.objectContaining({
        hostId: mockHost.id,
        status: 'syncing',
      }));
    });

    test('should include additional data in update', async () => {
      prisma.host.update.mockResolvedValue(mockHost);

      await hostService.updateHostStatus(mockHost.id, 'online', { ipAddress: '10.0.0.102' });

      expect(prisma.host.update).toHaveBeenCalledWith({
        where: { id: mockHost.id },
        data: expect.objectContaining({
          status: 'online',
          ipAddress: '10.0.0.102',
        }),
      });
    });

    test('should invalidate all related caches', async () => {
      prisma.host.update.mockResolvedValue(mockHost);

      await hostService.updateHostStatus(mockHost.id, 'offline');

      expect(redis.del).toHaveBeenCalledWith(`host:${mockHost.id}`);
      expect(redis.del).toHaveBeenCalledWith(`host:hostname:${mockHost.hostname}`);
      expect(redis.del).toHaveBeenCalledWith(`host:mac:${mockHost.macAddress.toLowerCase()}`);
    });
  });

  describe('bulkUpdateStatus', () => {
    test('should update multiple hosts', async () => {
      const hostIds = ['host-1', 'host-2', 'host-3'];
      prisma.host.updateMany.mockResolvedValue({ count: 3 });
      prisma.host.findMany.mockResolvedValue([
        { id: 'host-1', hostname: 'pc-01', status: 'offline', lastSeen: new Date() },
        { id: 'host-2', hostname: 'pc-02', status: 'offline', lastSeen: new Date() },
        { id: 'host-3', hostname: 'pc-03', status: 'offline', lastSeen: new Date() },
      ]);

      const result = await hostService.bulkUpdateStatus(hostIds, 'offline');

      expect(result.count).toBe(3);
      expect(prisma.host.updateMany).toHaveBeenCalledWith({
        where: { id: { in: hostIds } },
        data: expect.objectContaining({ status: 'offline' }),
      });
    });

    test('should invalidate pattern cache and broadcast events', async () => {
      prisma.host.updateMany.mockResolvedValue({ count: 2 });
      prisma.host.findMany.mockResolvedValue([
        { id: 'host-1', hostname: 'pc-01', status: 'offline', lastSeen: new Date() },
        { id: 'host-2', hostname: 'pc-02', status: 'offline', lastSeen: new Date() },
      ]);

      await hostService.bulkUpdateStatus(['host-1', 'host-2'], 'offline');

      expect(redis.delPattern).toHaveBeenCalledWith('host:*');
      expect(ws.broadcast).toHaveBeenCalledTimes(2);
    });
  });

  describe('getStaleHosts', () => {
    test('should find hosts where both lastSeen and lastOnlineAt are old', async () => {
      const staleHost = {
        id: 'stale-1',
        hostname: 'pc-stale',
        lastSeen: new Date(Date.now() - 700 * 1000),
        lastOnlineAt: new Date(Date.now() - 700 * 1000),
      };
      prisma.host.findMany.mockResolvedValue([staleHost]);

      const result = await hostService.getStaleHosts(600);

      expect(result).toEqual([staleHost]);
      expect(prisma.host.findMany).toHaveBeenCalledWith({
        where: {
          status: 'online',
          OR: expect.any(Array),
        },
        select: expect.objectContaining({
          id: true,
          hostname: true,
          lastSeen: true,
          lastOnlineAt: true,
        }),
      });
    });

    test('should use default 600 seconds threshold', async () => {
      prisma.host.findMany.mockResolvedValue([]);

      await hostService.getStaleHosts();

      expect(prisma.host.findMany).toHaveBeenCalledWith({
        where: {
          status: 'online',
          OR: expect.any(Array),
        },
        select: expect.any(Object),
      });
    });

    test('AC5: host with fresh lastOnlineAt is NOT stale even if lastSeen is old', async () => {
      // This test verifies the query structure includes OR with AND conditions
      prisma.host.findMany.mockResolvedValue([]);

      await hostService.getStaleHosts(600);

      const call = prisma.host.findMany.mock.calls[0][0];
      // Verify the OR structure handles both null and non-null lastOnlineAt
      expect(call.where.OR).toHaveLength(2);
      expect(call.where.OR[0]).toHaveProperty('lastOnlineAt', null);
      expect(call.where.OR[1]).toHaveProperty('AND');
    });
  });

  describe('markStaleHostsOffline', () => {
    test('should mark stale hosts as offline using seconds', async () => {
      const staleHosts = [
        { id: 'stale-1', hostname: 'pc-1', lastSeen: new Date(), lastOnlineAt: null },
        { id: 'stale-2', hostname: 'pc-2', lastSeen: new Date(), lastOnlineAt: null },
      ];
      prisma.host.findMany
        .mockResolvedValueOnce(staleHosts) // First call for getStaleHosts
        .mockResolvedValueOnce(staleHosts); // Second call for bulkUpdateStatus
      prisma.host.updateMany.mockResolvedValue({ count: 2 });

      const result = await hostService.markStaleHostsOffline(600);

      expect(result.count).toBe(2);
      expect(prisma.host.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'offline' }),
        })
      );
    });

    test('should return zero if no stale hosts', async () => {
      prisma.host.findMany.mockResolvedValue([]);

      const result = await hostService.markStaleHostsOffline(600);

      expect(result.count).toBe(0);
      expect(prisma.host.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('updateHostScanResult', () => {
    const currentHost = {
      id: 'host-1',
      hostname: 'pc-01',
      macAddress: 'aa:bb:cc:dd:ee:ff',
      ipAddress: '10.0.0.1',
      status: 'offline',
      detectedOs: null,
      lastOnlineAt: null,
    };

    test('AC1: no DB write when isOnline is false', async () => {
      const result = await hostService.updateHostScanResult(
        'host-1', currentHost, { isOnline: false }
      );

      expect(result).toBeNull();
      expect(prisma.host.update).not.toHaveBeenCalled();
    });

    test('should update status on online hit for offline host', async () => {
      prisma.host.update.mockResolvedValue({
        ...currentHost,
        status: 'online',
        detectedOs: 'linbo',
      });

      const result = await hostService.updateHostScanResult(
        'host-1', currentHost, { isOnline: true, detectedOs: 'linbo' }
      );

      expect(result).not.toBeNull();
      expect(prisma.host.update).toHaveBeenCalledWith({
        where: { id: 'host-1' },
        data: expect.objectContaining({
          status: 'online',
          detectedOs: 'linbo',
        }),
      });
      expect(ws.broadcast).toHaveBeenCalledWith('host.status.changed', expect.objectContaining({
        hostId: 'host-1',
        status: 'online',
        detectedOs: 'linbo',
      }));
    });

    test('AC4: no DB write when already online, same OS, lastOnlineAt is recent', async () => {
      const recentHost = {
        ...currentHost,
        status: 'online',
        detectedOs: 'linbo',
        lastOnlineAt: new Date(), // Just now — within TIMEOUT/2
      };

      const result = await hostService.updateHostScanResult(
        'host-1', recentHost, { isOnline: true, detectedOs: 'linbo' }
      );

      expect(result).toBeNull();
      expect(prisma.host.update).not.toHaveBeenCalled();
    });

    test('AC4: throttled bump when lastOnlineAt is old', async () => {
      const oldHost = {
        ...currentHost,
        status: 'online',
        detectedOs: 'linbo',
        lastOnlineAt: new Date(Date.now() - 200 * 1000), // 200s ago, > 150s threshold
      };
      prisma.host.update.mockResolvedValue({ ...oldHost, lastOnlineAt: new Date() });

      const result = await hostService.updateHostScanResult(
        'host-1', oldHost, { isOnline: true, detectedOs: 'linbo' }
      );

      expect(result).not.toBeNull();
      expect(prisma.host.update).toHaveBeenCalledWith({
        where: { id: 'host-1' },
        data: expect.objectContaining({
          lastOnlineAt: expect.any(Date),
          lastSeen: expect.any(Date),
        }),
      });
      // No WS broadcast for pure throttled bump
      expect(ws.broadcast).not.toHaveBeenCalled();
    });

    test('should broadcast on OS change', async () => {
      const onlineHost = {
        ...currentHost,
        status: 'online',
        detectedOs: 'linbo',
        lastOnlineAt: new Date(),
      };
      prisma.host.update.mockResolvedValue({ ...onlineHost, detectedOs: 'windows' });

      await hostService.updateHostScanResult(
        'host-1', onlineHost, { isOnline: true, detectedOs: 'windows' }
      );

      expect(ws.broadcast).toHaveBeenCalledWith('host.status.changed', expect.objectContaining({
        hostId: 'host-1',
      }));
    });

    test('should invalidate caches on update', async () => {
      prisma.host.update.mockResolvedValue({ ...currentHost, status: 'online' });

      await hostService.updateHostScanResult(
        'host-1', currentHost, { isOnline: true, detectedOs: 'linbo' }
      );

      expect(redis.del).toHaveBeenCalledWith('host:host-1');
      expect(redis.del).toHaveBeenCalledWith('host:hostname:pc-01');
      expect(redis.del).toHaveBeenCalledWith('host:mac:aa:bb:cc:dd:ee:ff');
    });

    test('AC3: scanner never sets offline (verified at service level)', async () => {
      // updateHostScanResult returns null when isOnline=false — never sets offline
      const onlineHost = {
        ...currentHost,
        status: 'online',
        detectedOs: 'windows',
        lastOnlineAt: new Date(),
      };

      const result = await hostService.updateHostScanResult(
        'host-1', onlineHost, { isOnline: false }
      );

      expect(result).toBeNull();
      expect(prisma.host.update).not.toHaveBeenCalled();
    });
  });

  describe('getHostConfig', () => {
    test('should return host-specific config if available', async () => {
      prisma.host.findUnique.mockResolvedValue(mockHostWithConfig);

      const result = await hostService.getHostConfig(mockHost.id);

      expect(result).toEqual(mockHostWithConfig.config);
    });

    test('should return null if no config available', async () => {
      const hostWithoutConfig = {
        ...mockHost,
        config: null,
      };
      prisma.host.findUnique.mockResolvedValue(hostWithoutConfig);

      const result = await hostService.getHostConfig(mockHost.id);

      expect(result).toBeNull();
    });

    test('should return null for non-existent host', async () => {
      prisma.host.findUnique.mockResolvedValue(null);

      const result = await hostService.getHostConfig('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getSyncProgress', () => {
    test('should return sync progress for active session', async () => {
      const mockSession = {
        id: 'session-1',
        hostId: mockHost.id,
        operationId: 'op-1',
        progress: 45,
        status: 'running',
        startedAt: new Date(),
        operation: { commands: ['sync'] },
      };
      prisma.session.findFirst.mockResolvedValue(mockSession);

      const result = await hostService.getSyncProgress(mockHost.id);

      expect(result.syncing).toBe(true);
      expect(result.sessionId).toBe('session-1');
      expect(result.progress).toBe(45);
    });

    test('should return syncing false if no active session', async () => {
      prisma.session.findFirst.mockResolvedValue(null);

      const result = await hostService.getSyncProgress(mockHost.id);

      expect(result.syncing).toBe(false);
    });
  });

  describe('getHostsByRoom', () => {
    test('should return hosts in room with status counts', async () => {
      const roomHosts = [
        { ...mockHost, status: 'online' },
        { ...mockHost, id: '2', hostname: 'pc-02', status: 'online' },
        { ...mockHost, id: '3', hostname: 'pc-03', status: 'offline' },
      ];
      prisma.host.findMany.mockResolvedValue(roomHosts);

      const result = await hostService.getHostsByRoom('room-1');

      expect(result.hosts).toEqual(roomHosts);
      expect(result.total).toBe(3);
      expect(result.statusCounts.online).toBe(2);
      expect(result.statusCounts.offline).toBe(1);
    });

    test('should order by hostname', async () => {
      prisma.host.findMany.mockResolvedValue([]);

      await hostService.getHostsByRoom('room-1');

      expect(prisma.host.findMany).toHaveBeenCalledWith({
        where: { roomId: 'room-1' },
        orderBy: { hostname: 'asc' },
        include: expect.any(Object),
      });
    });
  });

  describe('getHostsByConfig', () => {
    test('should return hosts in config with status counts', async () => {
      const configHosts = [
        { ...mockHost, status: 'syncing' },
        { ...mockHost, id: '2', hostname: 'pc-02', status: 'syncing' },
      ];
      prisma.host.findMany.mockResolvedValue(configHosts);

      const result = await hostService.getHostsByConfig('config-1');

      expect(result.hosts).toEqual(configHosts);
      expect(result.total).toBe(2);
      expect(result.statusCounts.syncing).toBe(2);
    });
  });
});
