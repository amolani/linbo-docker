/**
 * LINBO Docker - Host Status Worker Tests
 * Tests for stale timeout + port scanner
 */

// Track all created sockets for assertions (must be prefixed with 'mock' for jest.mock)
let mockCreatedSockets = [];

// Factory that creates a new mock socket per `new net.Socket()` call
function mockCreateSocket() {
  const handlers = {};
  const socket = {
    setTimeout: jest.fn(),
    once: jest.fn((event, cb) => {
      handlers[event] = cb;
    }),
    connect: jest.fn(),
    destroy: jest.fn(),
    _handlers: handlers,
    _fire: (event) => {
      if (handlers[event]) handlers[event]();
    },
  };
  mockCreatedSockets.push(socket);
  return socket;
}

jest.mock('net', () => ({
  Socket: jest.fn(() => mockCreateSocket()),
}));

// Mock dependencies
jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    host: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const mockRedisClient = {
  incr: jest.fn(),
  expire: jest.fn(),
  del: jest.fn(),
  set: jest.fn(),
  get: jest.fn(),
};

jest.mock('../../src/lib/redis', () => ({
  getClient: jest.fn(() => mockRedisClient),
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  delPattern: jest.fn(),
}));

jest.mock('../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
}));

jest.mock('../../src/services/host.service', () => ({
  markStaleHostsOffline: jest.fn(),
  updateHostScanResult: jest.fn(),
}));

const { prisma } = require('../../src/lib/prisma');
const redis = require('../../src/lib/redis');
const ws = require('../../src/lib/websocket');
const hostService = require('../../src/services/host.service');
const net = require('net');

// Import after mocks
const {
  checkPort,
  scanHost,
  runWithConcurrency,
  runScanCycle,
  runStaleCheck,
} = require('../../src/workers/host-status.worker');

describe('Host Status Worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreatedSockets = [];
  });

  // =========================================================================
  // checkPort
  // =========================================================================
  describe('checkPort', () => {
    test('should return true on successful connection', async () => {
      // Make socket fire 'connect' after connect() is called
      net.Socket.mockImplementationOnce(() => {
        const s = mockCreateSocket();
        s.connect.mockImplementation(() => {
          process.nextTick(() => s._fire('connect'));
        });
        return s;
      });

      const result = await checkPort('10.0.0.1', 22, 500);
      expect(result).toBe(true);
      const s = mockCreatedSockets[mockCreatedSockets.length - 1];
      expect(s.connect).toHaveBeenCalledWith(22, '10.0.0.1');
      expect(s.destroy).toHaveBeenCalled();
    });

    test('should return false on timeout', async () => {
      net.Socket.mockImplementationOnce(() => {
        const s = mockCreateSocket();
        s.connect.mockImplementation(() => {
          process.nextTick(() => s._fire('timeout'));
        });
        return s;
      });

      const result = await checkPort('10.0.0.1', 22, 500);
      expect(result).toBe(false);
    });

    test('should return false on error', async () => {
      net.Socket.mockImplementationOnce(() => {
        const s = mockCreateSocket();
        s.connect.mockImplementation(() => {
          process.nextTick(() => s._fire('error'));
        });
        return s;
      });

      const result = await checkPort('10.0.0.1', 22, 500);
      expect(result).toBe(false);
    });

    test('should set timeout on socket', async () => {
      net.Socket.mockImplementationOnce(() => {
        const s = mockCreateSocket();
        s.connect.mockImplementation(() => {
          process.nextTick(() => s._fire('timeout'));
        });
        return s;
      });

      await checkPort('10.0.0.1', 22, 750);
      const s = mockCreatedSockets[mockCreatedSockets.length - 1];
      expect(s.setTimeout).toHaveBeenCalledWith(750);
    });
  });

  // =========================================================================
  // scanHost
  // =========================================================================
  describe('scanHost', () => {
    // Helper to set up socket behavior for scanHost calls
    function setupPortBehavior(openPorts) {
      net.Socket.mockImplementation(() => {
        const s = mockCreateSocket();
        s.connect.mockImplementation((port) => {
          if (openPorts.includes(port)) {
            process.nextTick(() => s._fire('connect'));
          } else {
            process.nextTick(() => s._fire('timeout'));
          }
        });
        return s;
      });
    }

    test('should return not online for host without IP', async () => {
      const result = await scanHost({ hostname: 'test' }, 500);
      expect(result).toEqual({ isOnline: false, detectedOs: undefined });
    });

    test('should detect LINBO when port 2222 is open (early exit)', async () => {
      setupPortBehavior([2222]);

      const result = await scanHost({ ipAddress: '10.0.0.1' }, 500);
      expect(result).toEqual({ isOnline: true, detectedOs: 'linbo' });
      // Early exit: only 1 socket created (port 2222)
      expect(mockCreatedSockets.length).toBe(1);
    });

    test('should detect Linux when port 22 is open (2222 closed)', async () => {
      setupPortBehavior([22]);

      const result = await scanHost({ ipAddress: '10.0.0.1' }, 500);
      expect(result).toEqual({ isOnline: true, detectedOs: 'linux' });
      // 2 sockets: 2222 (closed) + 22 (open)
      expect(mockCreatedSockets.length).toBe(2);
    });

    test('should detect Windows when port 135 is open', async () => {
      setupPortBehavior([135]);

      const result = await scanHost({ ipAddress: '10.0.0.1' }, 500);
      expect(result).toEqual({ isOnline: true, detectedOs: 'windows' });
    });

    test('should detect Windows when port 445 is open', async () => {
      setupPortBehavior([445]);

      const result = await scanHost({ ipAddress: '10.0.0.1' }, 500);
      expect(result).toEqual({ isOnline: true, detectedOs: 'windows' });
    });

    test('should detect Windows when port 3389 is open', async () => {
      setupPortBehavior([3389]);

      const result = await scanHost({ ipAddress: '10.0.0.1' }, 500);
      expect(result).toEqual({ isOnline: true, detectedOs: 'windows' });
    });

    test('should return not online when no ports respond', async () => {
      setupPortBehavior([]);

      const result = await scanHost({ ipAddress: '10.0.0.1' }, 500);
      expect(result).toEqual({ isOnline: false, detectedOs: undefined });
      // All 5 ports checked: 2222, 22, 135, 445, 3389
      expect(mockCreatedSockets.length).toBe(5);
    });
  });

  // =========================================================================
  // runWithConcurrency
  // =========================================================================
  describe('runWithConcurrency', () => {
    test('should process all items', async () => {
      const items = [1, 2, 3, 4, 5];
      const fn = jest.fn(async (item) => item * 2);

      const results = await runWithConcurrency(items, fn, 3);

      expect(results).toEqual([2, 4, 6, 8, 10]);
      expect(fn).toHaveBeenCalledTimes(5);
    });

    test('should respect concurrency limit', async () => {
      let running = 0;
      let maxRunning = 0;

      const items = [1, 2, 3, 4, 5, 6];
      const fn = jest.fn(async (item) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise(r => setTimeout(r, 10));
        running--;
        return item;
      });

      await runWithConcurrency(items, fn, 2);

      expect(maxRunning).toBeLessThanOrEqual(2);
      expect(fn).toHaveBeenCalledTimes(6);
    });

    test('should handle empty array', async () => {
      const results = await runWithConcurrency([], jest.fn(), 5);
      expect(results).toEqual([]);
    });
  });

  // =========================================================================
  // runScanCycle
  // =========================================================================
  describe('runScanCycle', () => {
    const makeHost = (id, overrides = {}) => ({
      id: String(id),
      hostname: `pc-${id}`,
      macAddress: `aa:bb:cc:dd:ee:${String(id).padStart(2, '0')}`,
      ipAddress: `10.0.0.${id}`,
      status: 'offline',
      detectedOs: null,
      lastOnlineAt: null,
      ...overrides,
    });

    // Helper to make all ports closed
    function setupAllClosed() {
      net.Socket.mockImplementation(() => {
        const s = mockCreateSocket();
        s.connect.mockImplementation(() => {
          process.nextTick(() => s._fire('timeout'));
        });
        return s;
      });
    }

    // Helper to make specific host:port combos open
    function setupOpenPorts(portMap) {
      // portMap: { 'ip': [openPorts] }
      net.Socket.mockImplementation(() => {
        const s = mockCreateSocket();
        s.connect.mockImplementation((port, ip) => {
          const open = portMap[ip] || [];
          if (open.includes(port)) {
            process.nextTick(() => s._fire('connect'));
          } else {
            process.nextTick(() => s._fire('timeout'));
          }
        });
        return s;
      });
    }

    test('should skip if no hosts have IP addresses', async () => {
      prisma.host.findMany.mockResolvedValue([]);

      await runScanCycle();

      expect(hostService.updateHostScanResult).not.toHaveBeenCalled();
    });

    test('AC1: no-hit scan produces zero DB writes', async () => {
      const hosts = [makeHost(1), makeHost(2), makeHost(3)];
      prisma.host.findMany.mockResolvedValue(hosts);
      mockRedisClient.incr.mockResolvedValue(1);
      mockRedisClient.expire.mockResolvedValue(1);

      setupAllClosed();

      await runScanCycle();

      // updateHostScanResult never called for no-hits
      expect(hostService.updateHostScanResult).not.toHaveBeenCalled();
      // Redis fail counter incremented for each host
      expect(mockRedisClient.incr).toHaveBeenCalledTimes(3);
    });

    test('AC3: scanner never sets offline', async () => {
      // Host is currently online, scan returns no-hit
      const hosts = [makeHost(1, { status: 'online', detectedOs: 'windows' })];
      prisma.host.findMany.mockResolvedValue(hosts);
      mockRedisClient.incr.mockResolvedValue(1);
      mockRedisClient.expire.mockResolvedValue(1);

      setupAllClosed();

      await runScanCycle();

      expect(hostService.updateHostScanResult).not.toHaveBeenCalled();
      // prisma.host.update not called to set offline
      expect(prisma.host.update).not.toHaveBeenCalled();
    });

    test('should call updateHostScanResult for online hosts', async () => {
      const hosts = [makeHost(1, { status: 'offline' })];
      prisma.host.findMany.mockResolvedValue(hosts);
      hostService.updateHostScanResult.mockResolvedValue({ id: '1', status: 'online' });

      // Port 2222 open (LINBO)
      setupOpenPorts({ '10.0.0.1': [2222] });

      await runScanCycle();

      expect(hostService.updateHostScanResult).toHaveBeenCalledWith(
        '1',
        hosts[0],
        { isOnline: true, detectedOs: 'linbo' }
      );
      // Reset fail counter
      expect(mockRedisClient.del).toHaveBeenCalledWith('host:scan:fails:1');
    });

    test('AC6: detectedOs cleared after STALE_AFTER fails (only if non-null) with WS broadcast', async () => {
      const hosts = [makeHost(1, { status: 'online', detectedOs: 'windows' })];
      prisma.host.findMany.mockResolvedValue(hosts);
      mockRedisClient.incr.mockResolvedValue(5); // Reaches STALE_AFTER
      mockRedisClient.expire.mockResolvedValue(1);
      prisma.host.update.mockResolvedValue({ ...hosts[0], detectedOs: null });

      setupAllClosed();

      await runScanCycle();

      expect(prisma.host.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { detectedOs: null },
      });
      expect(mockRedisClient.del).toHaveBeenCalledWith('host:scan:fails:1');
      // Verify WS broadcast notifies frontend of cleared OS
      expect(ws.broadcast).toHaveBeenCalledWith('host.status.changed', expect.objectContaining({
        hostId: '1',
        hostname: 'pc-1',
        status: 'online',
        detectedOs: null,
      }));
    });

    test('AC6: detectedOs=null NOT written if already null', async () => {
      const hosts = [makeHost(1, { status: 'online', detectedOs: null })];
      prisma.host.findMany.mockResolvedValue(hosts);
      mockRedisClient.incr.mockResolvedValue(6);
      mockRedisClient.expire.mockResolvedValue(1);

      setupAllClosed();

      await runScanCycle();

      expect(prisma.host.update).not.toHaveBeenCalled();
    });

    test('AC2: dbWrites count matches actual writes', async () => {
      const hosts = [
        makeHost(1, { status: 'offline', detectedOs: null }),
        makeHost(2, { status: 'online', detectedOs: 'linbo', lastOnlineAt: new Date() }),
        makeHost(3, { status: 'offline', detectedOs: null }),
      ];
      prisma.host.findMany.mockResolvedValue(hosts);

      // Host 1 & 2: port 2222 open, Host 3: all closed
      setupOpenPorts({
        '10.0.0.1': [2222],
        '10.0.0.2': [2222],
      });

      hostService.updateHostScanResult
        .mockResolvedValueOnce({ id: '1', status: 'online' }) // Host 1: changed
        .mockResolvedValueOnce(null); // Host 2: nothing to do

      mockRedisClient.incr.mockResolvedValue(1);
      mockRedisClient.expire.mockResolvedValue(1);

      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await runScanCycle();

      const scanLog = logSpy.mock.calls.find(c => String(c[0]).includes('[HostScanner] cycle'));
      expect(scanLog).toBeTruthy();
      const logLine = scanLog[0];
      expect(logLine).toContain('scanned=3');
      expect(logLine).toContain('onlineHits=2');
      expect(logLine).toContain('dbWrites=1');
      expect(logLine).toContain('noHit=1');

      logSpy.mockRestore();
    });
  });

  // =========================================================================
  // runStaleCheck
  // =========================================================================
  describe('runStaleCheck', () => {
    test('should call markStaleHostsOffline with timeout', async () => {
      hostService.markStaleHostsOffline.mockResolvedValue({ count: 0, hosts: [] });

      await runStaleCheck();

      expect(hostService.markStaleHostsOffline).toHaveBeenCalledWith(300);
    });

    test('should log count when hosts marked offline', async () => {
      hostService.markStaleHostsOffline.mockResolvedValue({ count: 3, hosts: [] });
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await runStaleCheck();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Marked 3 stale host(s) offline')
      );
      logSpy.mockRestore();
    });

    test('should handle errors gracefully', async () => {
      hostService.markStaleHostsOffline.mockRejectedValue(new Error('DB error'));
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      await runStaleCheck();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Stale check error'),
        'DB error'
      );
      errorSpy.mockRestore();
    });
  });
});
