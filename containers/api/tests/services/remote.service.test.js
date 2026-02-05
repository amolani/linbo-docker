/**
 * LINBO Docker - Remote Service Tests
 * Tests für Remote Command Funktionalität
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// Set environment before importing service
const TEST_DIR = path.join(os.tmpdir(), `linbo-remote-test-${Date.now()}`);
const LINBOCMD_DIR = path.join(TEST_DIR, 'linbocmd');
process.env.LINBO_DIR = TEST_DIR;

// Mock Prisma
jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    host: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    operation: {
      create: jest.fn(),
      update: jest.fn(),
    },
    session: {
      update: jest.fn(),
    },
  },
}));

// Mock WebSocket
jest.mock('../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
}));

// Mock SSH Service
jest.mock('../../src/services/ssh.service', () => ({
  testConnection: jest.fn(),
  executeCommand: jest.fn(),
}));

// Mock WoL Service
jest.mock('../../src/services/wol.service', () => ({
  sendWakeOnLan: jest.fn(),
  sendWakeOnLanBulk: jest.fn(),
}));

// Mock Host Service
jest.mock('../../src/services/host.service', () => ({
  updateHostStatus: jest.fn(),
}));

const remoteService = require('../../src/services/remote.service');
const { prisma } = require('../../src/lib/prisma');
const ws = require('../../src/lib/websocket');

describe('Remote Service', () => {
  beforeAll(async () => {
    await fs.mkdir(LINBOCMD_DIR, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseCommands', () => {
    test('should parse simple command', () => {
      const result = remoteService.parseCommands('reboot');
      expect(result).toEqual([{ command: 'reboot', params: [] }]);
    });

    test('should parse command with number parameter', () => {
      const result = remoteService.parseCommands('sync:1');
      expect(result).toEqual([{ command: 'sync', params: [1] }]);
    });

    test('should parse multiple commands', () => {
      const result = remoteService.parseCommands('sync:1,start:1');
      expect(result).toEqual([
        { command: 'sync', params: [1] },
        { command: 'start', params: [1] },
      ]);
    });

    test('should parse initcache with download type', () => {
      const result = remoteService.parseCommands('initcache:rsync');
      expect(result).toEqual([{ command: 'initcache', params: ['rsync'] }]);
    });

    test('should parse format without parameter', () => {
      const result = remoteService.parseCommands('format');
      expect(result).toEqual([{ command: 'format', params: [] }]);
    });

    test('should parse format with partition number', () => {
      const result = remoteService.parseCommands('format:2');
      expect(result).toEqual([{ command: 'format', params: [2] }]);
    });

    test('should parse special flags', () => {
      const result = remoteService.parseCommands('noauto,disablegui');
      expect(result).toEqual([
        { command: 'noauto', params: [] },
        { command: 'disablegui', params: [] },
      ]);
    });

    test('should parse complex command string', () => {
      const result = remoteService.parseCommands('noauto,sync:1,start:1');
      expect(result).toEqual([
        { command: 'noauto', params: [] },
        { command: 'sync', params: [1] },
        { command: 'start', params: [1] },
      ]);
    });

    test('should throw error for unknown command', () => {
      expect(() => remoteService.parseCommands('unknown')).toThrow(
        'Unknown command: unknown'
      );
    });

    test('should throw error for invalid OS number', () => {
      expect(() => remoteService.parseCommands('sync:abc')).toThrow(
        'Invalid OS number for sync'
      );
    });

    test('should throw error for invalid download type', () => {
      expect(() => remoteService.parseCommands('initcache:invalid')).toThrow(
        'Invalid download type for initcache'
      );
    });
  });

  describe('validateCommandString', () => {
    test('should return valid for correct command string', () => {
      const result = remoteService.validateCommandString('sync:1,start:1');
      expect(result.valid).toBe(true);
      expect(result.commands).toHaveLength(2);
    });

    test('should return invalid for incorrect command string', () => {
      const result = remoteService.validateCommandString('invalid_command');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should return invalid for empty string', () => {
      const result = remoteService.validateCommandString('');
      expect(result.valid).toBe(false);
    });
  });

  describe('formatCommandsForWrapper', () => {
    test('should format simple commands', () => {
      const commands = [
        { command: 'sync', params: [1] },
        { command: 'start', params: [1] },
      ];
      const result = remoteService.formatCommandsForWrapper(commands);
      expect(result).toBe('sync:1,start:1');
    });

    test('should format commands without params', () => {
      const commands = [{ command: 'reboot', params: [] }];
      const result = remoteService.formatCommandsForWrapper(commands);
      expect(result).toBe('reboot');
    });

    test('should format initcache with type', () => {
      const commands = [{ command: 'initcache', params: ['rsync'] }];
      const result = remoteService.formatCommandsForWrapper(commands);
      expect(result).toBe('initcache:rsync');
    });
  });

  describe('scheduleOnbootCommands', () => {
    const mockHosts = [
      { id: '1', hostname: 'pc01', macAddress: 'aa:bb:cc:dd:ee:01' },
      { id: '2', hostname: 'pc02', macAddress: 'aa:bb:cc:dd:ee:02' },
    ];

    test('should create .cmd files for hosts', async () => {
      prisma.host.findMany.mockResolvedValue(mockHosts);
      prisma.host.update.mockResolvedValue({});

      const result = await remoteService.scheduleOnbootCommands(
        ['1', '2'],
        'sync:1,start:1'
      );

      expect(result.created).toContain('pc01');
      expect(result.created).toContain('pc02');
      expect(result.failed).toHaveLength(0);

      // Verify files were created
      const cmd1 = await fs.readFile(path.join(LINBOCMD_DIR, 'pc01.cmd'), 'utf8');
      expect(cmd1).toBe('sync:1,start:1');
    });

    test('should add noauto flag when specified', async () => {
      prisma.host.findMany.mockResolvedValue([mockHosts[0]]);
      prisma.host.update.mockResolvedValue({});

      await remoteService.scheduleOnbootCommands(['1'], 'sync:1', {
        noauto: true,
      });

      const cmd = await fs.readFile(path.join(LINBOCMD_DIR, 'pc01.cmd'), 'utf8');
      expect(cmd).toBe('noauto,sync:1');
    });

    test('should broadcast WebSocket event', async () => {
      prisma.host.findMany.mockResolvedValue([mockHosts[0]]);
      prisma.host.update.mockResolvedValue({});

      await remoteService.scheduleOnbootCommands(['1'], 'sync:1');

      expect(ws.broadcast).toHaveBeenCalledWith(
        'onboot.scheduled',
        expect.objectContaining({
          commands: 'sync:1',
          created: ['pc01'],
        })
      );
    });

    test('should throw error for invalid commands', async () => {
      await expect(
        remoteService.scheduleOnbootCommands(['1'], 'invalid')
      ).rejects.toThrow('Invalid command string');
    });

    test('should throw error when no hosts found', async () => {
      prisma.host.findMany.mockResolvedValue([]);

      await expect(
        remoteService.scheduleOnbootCommands(['1'], 'sync:1')
      ).rejects.toThrow('No valid hosts found');
    });
  });

  describe('listScheduledCommands', () => {
    test('should list all .cmd files', async () => {
      // Create test files
      await fs.writeFile(path.join(LINBOCMD_DIR, 'test-pc1.cmd'), 'sync:1');
      await fs.writeFile(path.join(LINBOCMD_DIR, 'test-pc2.cmd'), 'reboot');

      const result = await remoteService.listScheduledCommands();

      const pc1 = result.find(r => r.hostname === 'test-pc1');
      const pc2 = result.find(r => r.hostname === 'test-pc2');

      expect(pc1).toBeDefined();
      expect(pc1.commands).toBe('sync:1');
      expect(pc2).toBeDefined();
      expect(pc2.commands).toBe('reboot');
    });

    test('should return empty array for empty directory', async () => {
      // Clean directory
      const files = await fs.readdir(LINBOCMD_DIR);
      for (const file of files) {
        await fs.unlink(path.join(LINBOCMD_DIR, file));
      }

      const result = await remoteService.listScheduledCommands();
      expect(result).toEqual([]);
    });
  });

  describe('cancelScheduledCommand', () => {
    test('should delete .cmd file', async () => {
      // Create test file
      const cmdPath = path.join(LINBOCMD_DIR, 'cancel-test.cmd');
      await fs.writeFile(cmdPath, 'sync:1');

      prisma.host.findFirst.mockResolvedValue({
        id: '1',
        hostname: 'cancel-test',
        metadata: { scheduledCommand: 'sync:1' },
      });
      prisma.host.update.mockResolvedValue({});

      const result = await remoteService.cancelScheduledCommand('cancel-test');

      expect(result).toBe(true);

      // Verify file was deleted
      await expect(fs.access(cmdPath)).rejects.toThrow();
    });

    test('should broadcast WebSocket event', async () => {
      const cmdPath = path.join(LINBOCMD_DIR, 'cancel-ws-test.cmd');
      await fs.writeFile(cmdPath, 'sync:1');

      prisma.host.findFirst.mockResolvedValue(null);

      await remoteService.cancelScheduledCommand('cancel-ws-test');

      expect(ws.broadcast).toHaveBeenCalledWith('onboot.cancelled', {
        hostname: 'cancel-ws-test',
      });
    });

    test('should return false for non-existent file', async () => {
      const result = await remoteService.cancelScheduledCommand('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getHostsByFilter', () => {
    test('should filter by hostIds', async () => {
      const mockHosts = [{ id: '1', hostname: 'pc01' }];
      prisma.host.findMany.mockResolvedValue(mockHosts);

      const result = await remoteService.getHostsByFilter({ hostIds: ['1'] });

      expect(prisma.host.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['1'] } },
        })
      );
      expect(result).toEqual(mockHosts);
    });

    test('should filter by roomId', async () => {
      const mockHosts = [{ id: '1', hostname: 'pc01' }];
      prisma.host.findMany.mockResolvedValue(mockHosts);

      await remoteService.getHostsByFilter({ roomId: 'room-1' });

      expect(prisma.host.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { roomId: 'room-1' },
        })
      );
    });

    test('should filter by groupId', async () => {
      const mockHosts = [{ id: '1', hostname: 'pc01' }];
      prisma.host.findMany.mockResolvedValue(mockHosts);

      await remoteService.getHostsByFilter({ groupId: 'group-1' });

      expect(prisma.host.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { groupId: 'group-1' },
        })
      );
    });

    test('should throw error when no filter specified', async () => {
      await expect(remoteService.getHostsByFilter({})).rejects.toThrow(
        'No filter specified'
      );
    });
  });

  describe('KNOWN_COMMANDS', () => {
    test('should include all expected commands', () => {
      expect(remoteService.KNOWN_COMMANDS).toContain('sync');
      expect(remoteService.KNOWN_COMMANDS).toContain('start');
      expect(remoteService.KNOWN_COMMANDS).toContain('reboot');
      expect(remoteService.KNOWN_COMMANDS).toContain('halt');
      expect(remoteService.KNOWN_COMMANDS).toContain('partition');
      expect(remoteService.KNOWN_COMMANDS).toContain('format');
      expect(remoteService.KNOWN_COMMANDS).toContain('initcache');
      expect(remoteService.KNOWN_COMMANDS).toContain('create_image');
      expect(remoteService.KNOWN_COMMANDS).toContain('upload_image');
    });
  });

  describe('SPECIAL_FLAGS', () => {
    test('should include noauto and disablegui', () => {
      expect(remoteService.SPECIAL_FLAGS).toContain('noauto');
      expect(remoteService.SPECIAL_FLAGS).toContain('disablegui');
    });
  });
});
