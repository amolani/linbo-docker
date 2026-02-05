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
    test('should find hosts not seen within threshold', async () => {
      const staleHost = {
        id: 'stale-1',
        hostname: 'pc-stale',
        lastSeen: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago
      };
      prisma.host.findMany.mockResolvedValue([staleHost]);

      const result = await hostService.getStaleHosts(10);

      expect(result).toEqual([staleHost]);
      expect(prisma.host.findMany).toHaveBeenCalledWith({
        where: {
          status: 'online',
          lastSeen: { lt: expect.any(Date) },
        },
        select: expect.any(Object),
      });
    });

    test('should use default 10 minutes threshold', async () => {
      prisma.host.findMany.mockResolvedValue([]);

      await hostService.getStaleHosts();

      expect(prisma.host.findMany).toHaveBeenCalledWith({
        where: {
          status: 'online',
          lastSeen: { lt: expect.any(Date) },
        },
        select: expect.any(Object),
      });
    });
  });

  describe('markStaleHostsOffline', () => {
    test('should mark stale hosts as offline', async () => {
      const staleHosts = [
        { id: 'stale-1', hostname: 'pc-1', lastSeen: new Date() },
        { id: 'stale-2', hostname: 'pc-2', lastSeen: new Date() },
      ];
      prisma.host.findMany
        .mockResolvedValueOnce(staleHosts) // First call for getStaleHosts
        .mockResolvedValueOnce(staleHosts); // Second call for bulkUpdateStatus
      prisma.host.updateMany.mockResolvedValue({ count: 2 });

      const result = await hostService.markStaleHostsOffline(10);

      expect(result.count).toBe(2);
      expect(prisma.host.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'offline' }),
        })
      );
    });

    test('should return zero if no stale hosts', async () => {
      prisma.host.findMany.mockResolvedValue([]);

      const result = await hostService.markStaleHostsOffline(10);

      expect(result.count).toBe(0);
      expect(prisma.host.updateMany).not.toHaveBeenCalled();
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
