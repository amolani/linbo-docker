/**
 * LINBO Docker - Device Import Service Tests
 * Tests für CSV Import/Export Funktionalität
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// Set environment before importing service
const TEST_DIR = path.join(os.tmpdir(), `linbo-import-test-${Date.now()}`);
process.env.LINBO_DIR = TEST_DIR;

// Mock Prisma
jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    host: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    room: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    hostGroup: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
  },
}));

// Mock WebSocket
jest.mock('../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
}));

// Mock Config Service
jest.mock('../../src/services/config.service', () => ({
  createHostSymlinks: jest.fn(),
}));

// Mock GRUB Service
jest.mock('../../src/services/grub.service', () => ({
  generateGroupGrubConfig: jest.fn(),
  generateHostGrubConfig: jest.fn(),
  generateMainGrubConfig: jest.fn(),
}));

const deviceImportService = require('../../src/services/deviceImport.service');
const { prisma } = require('../../src/lib/prisma');
const ws = require('../../src/lib/websocket');

describe('Device Import Service', () => {
  beforeAll(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isValidMac', () => {
    test('should accept valid MAC with colons', () => {
      expect(deviceImportService.isValidMac('aa:bb:cc:dd:ee:ff')).toBe(true);
    });

    test('should accept valid MAC with dashes', () => {
      expect(deviceImportService.isValidMac('aa-bb-cc-dd-ee-ff')).toBe(true);
    });

    test('should accept uppercase MAC', () => {
      expect(deviceImportService.isValidMac('AA:BB:CC:DD:EE:FF')).toBe(true);
    });

    test('should reject invalid MAC - too short', () => {
      expect(deviceImportService.isValidMac('aa:bb:cc')).toBe(false);
    });

    test('should reject invalid MAC - invalid chars', () => {
      expect(deviceImportService.isValidMac('gg:hh:ii:jj:kk:ll')).toBe(false);
    });

    test('should reject empty string', () => {
      expect(deviceImportService.isValidMac('')).toBe(false);
    });

    test('should reject null', () => {
      expect(deviceImportService.isValidMac(null)).toBe(false);
    });
  });

  describe('isValidIp', () => {
    test('should accept valid IP', () => {
      expect(deviceImportService.isValidIp('192.168.1.100')).toBe(true);
    });

    test('should accept DHCP as valid', () => {
      expect(deviceImportService.isValidIp('DHCP')).toBe(true);
    });

    test('should accept empty/null as valid', () => {
      expect(deviceImportService.isValidIp('')).toBe(true);
      expect(deviceImportService.isValidIp(null)).toBe(true);
    });

    test('should reject IP with invalid octet', () => {
      expect(deviceImportService.isValidIp('192.168.1.300')).toBe(false);
    });

    test('should reject IP with wrong format', () => {
      expect(deviceImportService.isValidIp('192.168.1')).toBe(false);
    });
  });

  describe('isValidHostname', () => {
    test('should accept valid hostname', () => {
      expect(deviceImportService.isValidHostname('pc01')).toBe(true);
    });

    test('should accept hostname with dashes', () => {
      expect(deviceImportService.isValidHostname('pc-r101-01')).toBe(true);
    });

    test('should accept hostname with numbers', () => {
      expect(deviceImportService.isValidHostname('pc123')).toBe(true);
    });

    test('should reject hostname starting with dash', () => {
      expect(deviceImportService.isValidHostname('-pc01')).toBe(false);
    });

    test('should reject hostname with special chars', () => {
      expect(deviceImportService.isValidHostname('pc_01')).toBe(false);
    });

    test('should reject empty hostname', () => {
      expect(deviceImportService.isValidHostname('')).toBe(false);
    });
  });

  describe('normalizeMac', () => {
    test('should convert to lowercase with colons', () => {
      expect(deviceImportService.normalizeMac('AA:BB:CC:DD:EE:FF')).toBe(
        'aa:bb:cc:dd:ee:ff'
      );
    });

    test('should convert dashes to colons', () => {
      expect(deviceImportService.normalizeMac('aa-bb-cc-dd-ee-ff')).toBe(
        'aa:bb:cc:dd:ee:ff'
      );
    });
  });

  describe('parseCsvLine', () => {
    test('should parse semicolon-separated line', () => {
      const result = deviceImportService.parseCsvLine('field1;field2;field3');
      expect(result).toEqual(['field1', 'field2', 'field3']);
    });

    test('should handle quoted fields', () => {
      const result = deviceImportService.parseCsvLine(
        'field1;"field;with;semicolons";field3'
      );
      expect(result).toEqual(['field1', 'field;with;semicolons', 'field3']);
    });

    test('should trim whitespace', () => {
      const result = deviceImportService.parseCsvLine(' field1 ; field2 ; field3 ');
      expect(result).toEqual(['field1', 'field2', 'field3']);
    });
  });

  describe('parseCsv', () => {
    test('should parse multiple lines', () => {
      const csv = `room1;pc01;group1;aa:bb:cc:dd:ee:01;10.0.0.1
room1;pc02;group1;aa:bb:cc:dd:ee:02;10.0.0.2`;

      const result = deviceImportService.parseCsv(csv);

      expect(result).toHaveLength(2);
      expect(result[0].lineNumber).toBe(1);
      expect(result[1].lineNumber).toBe(2);
    });

    test('should skip empty lines', () => {
      const csv = `room1;pc01;group1;aa:bb:cc:dd:ee:01;10.0.0.1

room1;pc02;group1;aa:bb:cc:dd:ee:02;10.0.0.2`;

      const result = deviceImportService.parseCsv(csv);
      expect(result).toHaveLength(2);
    });

    test('should skip comment lines', () => {
      const csv = `# This is a comment
room1;pc01;group1;aa:bb:cc:dd:ee:01;10.0.0.1
# Another comment
room1;pc02;group1;aa:bb:cc:dd:ee:02;10.0.0.2`;

      const result = deviceImportService.parseCsv(csv);
      expect(result).toHaveLength(2);
    });
  });

  describe('validateCsvRow', () => {
    test('should validate correct row', () => {
      const row = {
        lineNumber: 1,
        fields: [
          'room1',
          'pc01',
          'group1',
          'aa:bb:cc:dd:ee:ff',
          '10.0.0.1',
          '',
          '',
          '',
          '',
          'student',
          '',
          '1',
        ],
      };

      const result = deviceImportService.validateCsvRow(row);

      expect(result.valid).toBe(true);
      expect(result.data.room).toBe('room1');
      expect(result.data.hostname).toBe('pc01');
      expect(result.data.group).toBe('group1');
      expect(result.data.macAddress).toBe('aa:bb:cc:dd:ee:ff');
      expect(result.data.ipAddress).toBe('10.0.0.1');
    });

    test('should reject row with missing fields', () => {
      const row = {
        lineNumber: 1,
        fields: ['room1', 'pc01'],
      };

      const result = deviceImportService.validateCsvRow(row);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Line 1: Not enough fields (minimum 5 required)'
      );
    });

    test('should reject row with invalid MAC', () => {
      const row = {
        lineNumber: 1,
        fields: ['room1', 'pc01', 'group1', 'invalid-mac', '10.0.0.1'],
      };

      const result = deviceImportService.validateCsvRow(row);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid MAC'))).toBe(true);
    });

    test('should reject row with invalid hostname', () => {
      const row = {
        lineNumber: 1,
        fields: ['room1', 'pc_invalid', 'group1', 'aa:bb:cc:dd:ee:ff', '10.0.0.1'],
      };

      const result = deviceImportService.validateCsvRow(row);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid hostname'))).toBe(true);
    });

    test('should handle DHCP as IP', () => {
      const row = {
        lineNumber: 1,
        fields: ['room1', 'pc01', 'group1', 'aa:bb:cc:dd:ee:ff', 'DHCP'],
      };

      const result = deviceImportService.validateCsvRow(row);

      expect(result.valid).toBe(true);
      expect(result.data.ipAddress).toBeNull();
    });

    test('should handle nopxe group', () => {
      const row = {
        lineNumber: 1,
        fields: ['room1', 'pc01', 'nopxe', 'aa:bb:cc:dd:ee:ff', '10.0.0.1'],
      };

      const result = deviceImportService.validateCsvRow(row);

      expect(result.valid).toBe(true);
      expect(result.data.group).toBeNull();
      expect(result.data.isPxeEnabled).toBe(false);
      expect(result.warnings.some(w => w.includes('no PXE group'))).toBe(true);
    });
  });

  describe('validateCsv', () => {
    test('should validate complete CSV', () => {
      const csv = `room1;pc01;group1;aa:bb:cc:dd:ee:01;10.0.0.1
room1;pc02;group1;aa:bb:cc:dd:ee:02;10.0.0.2`;

      const result = deviceImportService.validateCsv(csv);

      expect(result.valid).toBe(true);
      expect(result.summary.total).toBe(2);
      expect(result.summary.valid).toBe(2);
      expect(result.summary.invalid).toBe(0);
    });

    test('should detect duplicate MACs', () => {
      const csv = `room1;pc01;group1;aa:bb:cc:dd:ee:01;10.0.0.1
room1;pc02;group1;aa:bb:cc:dd:ee:01;10.0.0.2`;

      const result = deviceImportService.validateCsv(csv);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate MAC'))).toBe(true);
    });

    test('should detect duplicate hostnames', () => {
      const csv = `room1;pc01;group1;aa:bb:cc:dd:ee:01;10.0.0.1
room1;pc01;group1;aa:bb:cc:dd:ee:02;10.0.0.2`;

      const result = deviceImportService.validateCsv(csv);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate hostname'))).toBe(true);
    });

    test('should return error for empty CSV', () => {
      const result = deviceImportService.validateCsv('');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'CSV file is empty or contains only comments'
      );
    });
  });

  describe('importFromCsv - dryRun', () => {
    test('should return validation result without importing', async () => {
      const csv = `room1;pc01;group1;aa:bb:cc:dd:ee:01;10.0.0.1`;

      prisma.host.findMany.mockResolvedValue([]);

      const result = await deviceImportService.importFromCsv(csv, {
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.validation.valid).toBe(true);
      expect(prisma.host.create).not.toHaveBeenCalled();
    });
  });

  describe('importFromCsv - actual import', () => {
    test('should create new hosts', async () => {
      const csv = `room1;pc01;group1;aa:bb:cc:dd:ee:01;10.0.0.1`;

      prisma.room.findUnique.mockResolvedValue(null);
      prisma.room.create.mockResolvedValue({ id: 'room-1', name: 'room1' });
      prisma.hostGroup.findUnique.mockResolvedValue(null);
      prisma.hostGroup.create.mockResolvedValue({ id: 'group-1', name: 'group1' });
      prisma.host.findUnique.mockResolvedValue(null);
      prisma.host.create.mockResolvedValue({ id: 'host-1', hostname: 'pc01' });

      const result = await deviceImportService.importFromCsv(csv, {
        dryRun: false,
        createRooms: true,
        createGroups: true,
      });

      expect(result.success).toBe(true);
      expect(result.imported.created).toBe(1);
      expect(prisma.host.create).toHaveBeenCalled();
    });

    test('should broadcast WebSocket event on completion', async () => {
      const csv = `room1;pc01;group1;aa:bb:cc:dd:ee:01;10.0.0.1`;

      prisma.room.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.hostGroup.findUnique.mockResolvedValue({ id: 'group-1' });
      prisma.host.findUnique.mockResolvedValue(null);
      prisma.host.create.mockResolvedValue({ id: 'host-1' });

      await deviceImportService.importFromCsv(csv, { dryRun: false });

      expect(ws.broadcast).toHaveBeenCalledWith(
        'import.completed',
        expect.objectContaining({
          created: 1,
        })
      );
    });
  });

  describe('exportToCsv', () => {
    test('should export hosts as CSV', async () => {
      prisma.host.findMany.mockResolvedValue([
        {
          hostname: 'pc01',
          macAddress: 'aa:bb:cc:dd:ee:01',
          ipAddress: '10.0.0.1',
          room: { name: 'room1' },
          group: { name: 'group1' },
          metadata: { computerType: 'student', pxeFlag: 1 },
        },
      ]);

      const csv = await deviceImportService.exportToCsv();

      expect(csv).toContain('room1;pc01;group1;AA:BB:CC:DD:EE:01;10.0.0.1');
      expect(csv).toContain('# LINBO Docker - Exported devices');
    });

    test('should handle hosts without room or group', async () => {
      prisma.host.findMany.mockResolvedValue([
        {
          hostname: 'pc01',
          macAddress: 'aa:bb:cc:dd:ee:01',
          ipAddress: null,
          room: null,
          group: null,
          metadata: {},
        },
      ]);

      const csv = await deviceImportService.exportToCsv();

      expect(csv).toContain('unknown;pc01;nopxe;AA:BB:CC:DD:EE:01;DHCP');
    });
  });

  describe('CSV_COLUMNS', () => {
    test('should have correct column indices', () => {
      expect(deviceImportService.CSV_COLUMNS.ROOM).toBe(0);
      expect(deviceImportService.CSV_COLUMNS.HOSTNAME).toBe(1);
      expect(deviceImportService.CSV_COLUMNS.GROUP).toBe(2);
      expect(deviceImportService.CSV_COLUMNS.MAC).toBe(3);
      expect(deviceImportService.CSV_COLUMNS.IP).toBe(4);
      expect(deviceImportService.CSV_COLUMNS.PXE_FLAG).toBe(11);
    });
  });
});
