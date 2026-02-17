/**
 * LINBO Docker - Patchclass Service Tests
 * Tests for path security, patchclass/driver-set/driver-map CRUD,
 * ZIP extraction, rule generation, and postsync template generation
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// Create isolated test directories
const TEST_BASE = path.join(os.tmpdir(), `patchclass-test-${Date.now()}`);
const TEST_PC_BASE = path.join(TEST_BASE, 'linuxmuster-client');
const TEST_IMAGE_DIR = path.join(TEST_BASE, 'images');

// Set environment BEFORE importing services
process.env.PATCHCLASS_BASE = TEST_PC_BASE;
process.env.IMAGE_DIR = TEST_IMAGE_DIR;
process.env.LINBO_DIR = TEST_BASE;
process.env.SRV_LINBO_DIR = TEST_BASE;

// Mock websocket
jest.mock('../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
}));

// Mock child_process for ZIP extraction tests
const mockExecFile = jest.fn();
jest.mock('child_process', () => ({
  execFile: mockExecFile,
}));

const patchclassService = require('../../src/services/patchclass.service');

// =============================================================================
// Helpers
// =============================================================================

async function setupDirs() {
  await fs.mkdir(TEST_PC_BASE, { recursive: true });
  await fs.mkdir(TEST_IMAGE_DIR, { recursive: true });
}

async function cleanDirs() {
  await fs.rm(TEST_BASE, { recursive: true, force: true }).catch(() => {});
}

// =============================================================================
// Tests
// =============================================================================

describe('Patchclass Service', () => {
  beforeEach(async () => {
    await cleanDirs();
    await setupDirs();
    jest.clearAllMocks();
    // Default mock for execFile (promisified)
    mockExecFile.mockImplementation((cmd, args, opts, callback) => {
      if (typeof opts === 'function') { callback = opts; opts = {}; }
      if (callback) callback(null, '', '');
    });
  });

  afterAll(async () => {
    await cleanDirs();
  });

  // ===========================================================================
  // sanitizeName
  // ===========================================================================

  describe('sanitizeName()', () => {
    test('accepts valid names', () => {
      expect(patchclassService.sanitizeName('win11-pc')).toBe('win11-pc');
      expect(patchclassService.sanitizeName('Dell_OptiPlex-7090')).toBe('Dell_OptiPlex-7090');
      expect(patchclassService.sanitizeName('a')).toBe('a');
      expect(patchclassService.sanitizeName('test.class')).toBe('test.class');
    });

    test('rejects empty name', () => {
      expect(() => patchclassService.sanitizeName('')).toThrow(/must not be empty/);
      expect(() => patchclassService.sanitizeName(null)).toThrow(/must not be empty/);
    });

    test('rejects names starting with non-alphanumeric', () => {
      expect(() => patchclassService.sanitizeName('.hidden')).toThrow();
      expect(() => patchclassService.sanitizeName('-dash')).toThrow();
      expect(() => patchclassService.sanitizeName('_under')).toThrow();
    });

    test('rejects names with invalid characters', () => {
      expect(() => patchclassService.sanitizeName('foo/bar')).toThrow();
      expect(() => patchclassService.sanitizeName('foo bar')).toThrow();
      // 'foo..bar' is valid since regex allows dots (e.g. Dell_OptiPlex.7090)
    });

    test('rejects names longer than 100 chars', () => {
      expect(() => patchclassService.sanitizeName('a'.repeat(101))).toThrow();
    });

    test('rejects names with path traversal chars', () => {
      expect(() => patchclassService.sanitizeName('a/b')).toThrow();
      expect(() => patchclassService.sanitizeName('a\\b')).toThrow();
    });
  });

  // ===========================================================================
  // sanitizeRelativePath
  // ===========================================================================

  describe('sanitizeRelativePath()', () => {
    test('accepts valid relative paths', () => {
      expect(patchclassService.sanitizeRelativePath('NIC/e1000e.inf')).toBe('NIC/e1000e.inf');
      expect(patchclassService.sanitizeRelativePath('driver.sys')).toBe('driver.sys');
      expect(patchclassService.sanitizeRelativePath('GPU/AMD/amd.cat')).toBe('GPU/AMD/amd.cat');
    });

    test('rejects path traversal', () => {
      expect(() => patchclassService.sanitizeRelativePath('../etc/passwd')).toThrow(/traversal/);
      expect(() => patchclassService.sanitizeRelativePath('foo/../bar')).toThrow(/traversal/);
      expect(() => patchclassService.sanitizeRelativePath('..')).toThrow(/traversal/);
    });

    test('rejects absolute paths', () => {
      expect(() => patchclassService.sanitizeRelativePath('/etc/passwd')).toThrow(/Absolute/);
    });

    test('rejects backslashes', () => {
      expect(() => patchclassService.sanitizeRelativePath('NIC\\e1000e.inf')).toThrow(/Backslash/);
    });

    test('rejects NUL bytes', () => {
      expect(() => patchclassService.sanitizeRelativePath('foo\0bar')).toThrow(/NUL/);
    });

    test('normalizes double slashes', () => {
      expect(patchclassService.sanitizeRelativePath('NIC//e1000e.inf')).toBe('NIC/e1000e.inf');
    });
  });

  // ===========================================================================
  // Patchclass CRUD
  // ===========================================================================

  describe('Patchclass CRUD', () => {
    test('create and list patchclass', async () => {
      const result = await patchclassService.createPatchclass('win11-lab');
      expect(result.name).toBe('win11-lab');
      expect(result.modelCount).toBe(0);

      // Verify directory structure
      const stat = await fs.stat(path.join(TEST_PC_BASE, 'win11-lab', 'drivers'));
      expect(stat.isDirectory()).toBe(true);
      const stat2 = await fs.stat(path.join(TEST_PC_BASE, 'win11-lab', 'common', 'postsync.d'));
      expect(stat2.isDirectory()).toBe(true);

      // Verify driver-map.json created
      const mapRaw = await fs.readFile(path.join(TEST_PC_BASE, 'win11-lab', 'driver-map.json'), 'utf-8');
      const map = JSON.parse(mapRaw);
      expect(map.version).toBe(1);
      expect(map.defaultDrivers).toEqual(['_generic']);

      // Verify driver-rules.sh generated
      const rules = await fs.readFile(path.join(TEST_PC_BASE, 'win11-lab', 'driver-rules.sh'), 'utf-8');
      expect(rules).toContain('match_drivers()');

      // List
      const list = await patchclassService.listPatchclasses();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('win11-lab');
    });

    test('create duplicate throws 409', async () => {
      await patchclassService.createPatchclass('dup-test');
      await expect(patchclassService.createPatchclass('dup-test'))
        .rejects.toThrow(/already exists/);
    });

    test('delete patchclass', async () => {
      await patchclassService.createPatchclass('to-delete');
      const result = await patchclassService.deletePatchclass('to-delete');
      expect(result.deleted).toBe('to-delete');

      const list = await patchclassService.listPatchclasses();
      expect(list).toHaveLength(0);
    });

    test('delete nonexistent throws 404', async () => {
      await expect(patchclassService.deletePatchclass('nonexistent'))
        .rejects.toThrow(/not found/);
    });

    test('get detail', async () => {
      await patchclassService.createPatchclass('detail-test');
      const detail = await patchclassService.getPatchclassDetail('detail-test');
      expect(detail.name).toBe('detail-test');
      expect(detail.driverSets).toEqual([]);
      expect(detail.driverMap.version).toBe(1);
    });
  });

  // ===========================================================================
  // Driver Set CRUD
  // ===========================================================================

  describe('Driver Set CRUD', () => {
    beforeEach(async () => {
      await patchclassService.createPatchclass('test-pc');
    });

    test('create and list driver sets', async () => {
      const result = await patchclassService.createDriverSet('test-pc', 'Dell_OptiPlex-7090');
      expect(result.name).toBe('Dell_OptiPlex-7090');
      expect(result.fileCount).toBe(0);

      const list = await patchclassService.listDriverSets('test-pc');
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('Dell_OptiPlex-7090');
    });

    test('create duplicate driver set throws 409', async () => {
      await patchclassService.createDriverSet('test-pc', 'dup-set');
      await expect(patchclassService.createDriverSet('test-pc', 'dup-set'))
        .rejects.toThrow(/already exists/);
    });

    test('create driver set for nonexistent patchclass throws 404', async () => {
      await expect(patchclassService.createDriverSet('nonexistent', 'set1'))
        .rejects.toThrow(/not found/);
    });

    test('delete driver set', async () => {
      await patchclassService.createDriverSet('test-pc', 'to-delete');
      const result = await patchclassService.deleteDriverSet('test-pc', 'to-delete');
      expect(result.deleted).toBe('to-delete');
    });

    test('delete nonexistent driver set throws 404', async () => {
      await expect(patchclassService.deleteDriverSet('test-pc', 'nonexistent'))
        .rejects.toThrow(/not found/);
    });
  });

  // ===========================================================================
  // File Upload/Delete
  // ===========================================================================

  describe('File Upload/Delete', () => {
    beforeEach(async () => {
      await patchclassService.createPatchclass('file-test');
      await patchclassService.createDriverSet('file-test', 'NIC');
    });

    test('upload and list files', async () => {
      const result = await patchclassService.uploadDriverFile(
        'file-test', 'NIC', 'e1000e.inf', Buffer.from('[Driver]\nSignature="$CHICAGO$"')
      );
      expect(result.path).toBe('e1000e.inf');
      expect(result.size).toBeGreaterThan(0);

      const files = await patchclassService.listDriverSetFiles('file-test', 'NIC');
      expect(files.some(f => f.name === 'e1000e.inf')).toBe(true);
    });

    test('upload file with subdirectory', async () => {
      await patchclassService.uploadDriverFile(
        'file-test', 'NIC', 'Intel/e1000e.sys', Buffer.from('binary data')
      );

      const files = await patchclassService.listDriverSetFiles('file-test', 'NIC');
      expect(files.some(f => f.path === 'Intel/e1000e.sys')).toBe(true);
    });

    test('delete file', async () => {
      await patchclassService.uploadDriverFile(
        'file-test', 'NIC', 'to-delete.inf', Buffer.from('data')
      );
      const result = await patchclassService.deleteDriverFile('file-test', 'NIC', 'to-delete.inf');
      expect(result.deleted).toBe('to-delete.inf');
    });

    test('delete nonexistent file throws 404', async () => {
      await expect(patchclassService.deleteDriverFile('file-test', 'NIC', 'nonexistent.inf'))
        .rejects.toThrow(/not found/);
    });
  });

  // ===========================================================================
  // ZIP Extraction Security
  // ===========================================================================

  describe('ZIP Extraction', () => {
    beforeEach(async () => {
      await patchclassService.createPatchclass('zip-test');
      await patchclassService.createDriverSet('zip-test', 'drivers');
    });

    test('rejects ZIP with path traversal', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, callback) => {
        if (typeof opts === 'function') { callback = opts; opts = {}; }
        if (args[0] === '-l') {
          callback(null, '  100  02-10-26  14:00  ../../../etc/passwd\n', '');
        } else {
          callback(null, '', '');
        }
      });

      await expect(patchclassService.extractDriverZip('zip-test', 'drivers', '/tmp/evil.zip'))
        .rejects.toThrow(/traversal/);
    });

    test('rejects ZIP with absolute paths', async () => {
      mockExecFile.mockImplementation((cmd, args, opts, callback) => {
        if (typeof opts === 'function') { callback = opts; opts = {}; }
        if (args[0] === '-l') {
          callback(null, '  100  02-10-26  14:00  /etc/passwd\n', '');
        } else {
          callback(null, '', '');
        }
      });

      await expect(patchclassService.extractDriverZip('zip-test', 'drivers', '/tmp/evil.zip'))
        .rejects.toThrow(/absolute/);
    });

    test('rejects ZIP with too many entries', async () => {
      const lines = [];
      for (let i = 0; i < 1001; i++) {
        lines.push(`  100  02-10-26  14:00  file${i}.txt`);
      }

      mockExecFile.mockImplementation((cmd, args, opts, callback) => {
        if (typeof opts === 'function') { callback = opts; opts = {}; }
        if (args[0] === '-l') {
          callback(null, lines.join('\n') + '\n', '');
        } else {
          callback(null, '', '');
        }
      });

      await expect(patchclassService.extractDriverZip('zip-test', 'drivers', '/tmp/big.zip'))
        .rejects.toThrow(/too many entries/);
    });

    test('rejects ZIP that is too large', async () => {
      const hugeSize = 600 * 1024 * 1024; // 600MB > 500MB limit

      mockExecFile.mockImplementation((cmd, args, opts, callback) => {
        if (typeof opts === 'function') { callback = opts; opts = {}; }
        if (args[0] === '-l') {
          callback(null, `  ${hugeSize}  02-10-26  14:00  huge.bin\n`, '');
        } else {
          callback(null, '', '');
        }
      });

      await expect(patchclassService.extractDriverZip('zip-test', 'drivers', '/tmp/bomb.zip'))
        .rejects.toThrow(/too large/);
    });
  });

  // ===========================================================================
  // Driver Map CRUD + Validation
  // ===========================================================================

  describe('Driver Map CRUD', () => {
    beforeEach(async () => {
      await patchclassService.createPatchclass('map-test');
    });

    test('get default driver map', async () => {
      const map = await patchclassService.getDriverMap('map-test');
      expect(map.version).toBe(1);
      expect(map.defaultDrivers).toEqual(['_generic']);
      expect(map.models).toEqual([]);
    });

    test('update driver map', async () => {
      const newMap = {
        version: 1,
        defaultDrivers: ['_generic'],
        models: [{
          name: 'Dell OptiPlex 7090',
          match: { sys_vendor: 'Dell Inc.', product_name: 'OptiPlex 7090' },
          drivers: ['Dell_OptiPlex-7090'],
        }],
      };

      const result = await patchclassService.updateDriverMap('map-test', newMap);
      expect(result.models).toHaveLength(1);

      // Verify rules regenerated
      const rules = await fs.readFile(
        path.join(TEST_PC_BASE, 'map-test', 'driver-rules.sh'), 'utf-8'
      );
      expect(rules).toContain('Dell Inc.');
      expect(rules).toContain('OptiPlex 7090');
    });

    test('add and remove model', async () => {
      await patchclassService.addModel('map-test', {
        name: 'Lenovo ThinkCentre',
        match: { sys_vendor: 'LENOVO', product_name_contains: 'ThinkCentre M920' },
        drivers: ['Lenovo_ThinkCentre-M920q'],
      });

      let map = await patchclassService.getDriverMap('map-test');
      expect(map.models).toHaveLength(1);

      await patchclassService.removeModel('map-test', 'Lenovo ThinkCentre');
      map = await patchclassService.getDriverMap('map-test');
      expect(map.models).toHaveLength(0);
    });

    test('add duplicate model throws 409', async () => {
      await patchclassService.addModel('map-test', {
        name: 'Test Model',
        match: { sys_vendor: 'Test', product_name: 'Model 1' },
        drivers: ['test-set'],
      });

      await expect(patchclassService.addModel('map-test', {
        name: 'Test Model',
        match: { sys_vendor: 'Test', product_name: 'Model 2' },
        drivers: ['test-set'],
      })).rejects.toThrow(/already exists/);
    });

    test('remove nonexistent model throws 404', async () => {
      await expect(patchclassService.removeModel('map-test', 'Nonexistent'))
        .rejects.toThrow(/not found/);
    });
  });

  // ===========================================================================
  // Rule Generation
  // ===========================================================================

  describe('regenerateRules()', () => {
    beforeEach(async () => {
      await patchclassService.createPatchclass('rules-test');
    });

    test('generates correct case statement for exact match', async () => {
      await patchclassService.updateDriverMap('rules-test', {
        version: 1,
        defaultDrivers: ['_generic'],
        models: [{
          name: 'Dell OptiPlex 7090',
          match: { sys_vendor: 'Dell Inc.', product_name: 'OptiPlex 7090' },
          drivers: ['Dell_OptiPlex-7090'],
        }],
      });

      const rules = await fs.readFile(
        path.join(TEST_PC_BASE, 'rules-test', 'driver-rules.sh'), 'utf-8'
      );

      expect(rules).toContain('match_drivers()');
      expect(rules).toContain('"Dell Inc.|OptiPlex 7090"');
      expect(rules).toContain('DRIVER_SETS="Dell_OptiPlex-7090"');
      expect(rules).toContain('DRIVER_SETS="_generic"');
    });

    test('generates correct case statement for contains match', async () => {
      await patchclassService.updateDriverMap('rules-test', {
        version: 1,
        defaultDrivers: ['_generic'],
        models: [{
          name: 'Lenovo ThinkCentre M920q',
          match: { sys_vendor: 'LENOVO', product_name_contains: 'ThinkCentre M920' },
          drivers: ['Lenovo_ThinkCentre-M920q', '_generic'],
        }],
      });

      const rules = await fs.readFile(
        path.join(TEST_PC_BASE, 'rules-test', 'driver-rules.sh'), 'utf-8'
      );

      expect(rules).toContain('"LENOVO|*ThinkCentre M920*"');
      expect(rules).toContain('DRIVER_SETS="Lenovo_ThinkCentre-M920q _generic"');
    });

    test('escapes shell pattern characters in exact match', async () => {
      await patchclassService.updateDriverMap('rules-test', {
        version: 1,
        defaultDrivers: ['_generic'],
        models: [{
          name: 'HP Special',
          match: { sys_vendor: 'HP [S/N:12345]', product_name: 'ProDesk 400*G7' },
          drivers: ['HP_ProDesk-400'],
        }],
      });

      const rules = await fs.readFile(
        path.join(TEST_PC_BASE, 'rules-test', 'driver-rules.sh'), 'utf-8'
      );

      // [ and ] must be escaped, * must be escaped
      expect(rules).toContain('HP \\[S/N:12345\\]');
      expect(rules).toContain('ProDesk 400\\*G7');
    });

    test('escapes shell pattern characters in contains match', async () => {
      await patchclassService.updateDriverMap('rules-test', {
        version: 1,
        defaultDrivers: ['_generic'],
        models: [{
          name: 'Weird Vendor',
          match: { sys_vendor: 'Test?Corp', product_name_contains: 'Model [v2]' },
          drivers: ['weird-set'],
        }],
      });

      const rules = await fs.readFile(
        path.join(TEST_PC_BASE, 'rules-test', 'driver-rules.sh'), 'utf-8'
      );

      // ? must be escaped in vendor, [ ] must be escaped in contains inner text
      expect(rules).toContain('Test\\?Corp');
      expect(rules).toContain('*Model \\[v2\\]*');
    });

    test('includes hash in rules header', async () => {
      const result = await patchclassService.regenerateRules('rules-test');
      expect(result.hash).toMatch(/^[0-9a-f]{32}$/);

      const rules = await fs.readFile(
        path.join(TEST_PC_BASE, 'rules-test', 'driver-rules.sh'), 'utf-8'
      );
      expect(rules).toContain(`# Hash: ${result.hash}`);
    });
  });

  // ===========================================================================
  // Postsync Template Generation
  // ===========================================================================

  describe('Postsync Generation', () => {
    beforeEach(async () => {
      await patchclassService.createPatchclass('postsync-test');
    });

    test('generates postsync script with correct substitutions', async () => {
      const script = await patchclassService.generatePostsyncScript('postsync-test', 'win11.qcow2');
      expect(script).toContain('PATCHCLASS="postsync-test"');
      expect(script).toContain('IMAGENAME="win11.qcow2"');
      expect(script).not.toContain('{{PATCHCLASS}}');
      expect(script).not.toContain('{{IMAGENAME}}');
    });

    test('deploys postsync to image directory', async () => {
      const result = await patchclassService.deployPostsyncToImage('postsync-test', 'win11.qcow2');
      expect(result.postsync).toBe('win11.postsync');

      const content = await fs.readFile(path.join(TEST_IMAGE_DIR, 'win11.postsync'), 'utf-8');
      expect(content).toContain('PATCHCLASS="postsync-test"');
    });

    test('rejects invalid image name', async () => {
      await expect(patchclassService.deployPostsyncToImage('postsync-test', '../evil'))
        .rejects.toThrow(/Invalid image name/);
      await expect(patchclassService.deployPostsyncToImage('postsync-test', 'no-extension'))
        .rejects.toThrow(/Invalid image name/);
    });

    test('deploys to nonexistent patchclass throws 404', async () => {
      await expect(patchclassService.deployPostsyncToImage('nonexistent', 'win11.qcow2'))
        .rejects.toThrow(/not found/);
    });
  });

  // ===========================================================================
  // Shell Escaping Functions
  // ===========================================================================

  describe('Shell escaping', () => {
    test('shellEscapeExact escapes pattern characters', () => {
      expect(patchclassService.shellEscapeExact('normal text')).toBe('normal text');
      expect(patchclassService.shellEscapeExact('HP [S/N:123]')).toBe('HP \\[S/N:123\\]');
      expect(patchclassService.shellEscapeExact('Model 400*G7')).toBe('Model 400\\*G7');
      expect(patchclassService.shellEscapeExact('test?')).toBe('test\\?');
      expect(patchclassService.shellEscapeExact('back\\slash')).toBe('back\\\\slash');
    });

    test('shellEscapeContains wraps with wildcards', () => {
      expect(patchclassService.shellEscapeContains('ThinkCentre')).toBe('*ThinkCentre*');
      expect(patchclassService.shellEscapeContains('Model [v2]')).toBe('*Model \\[v2\\]*');
    });
  });

  // ===========================================================================
  // Device Rules
  // ===========================================================================

  describe('Device Rules', () => {
    beforeEach(async () => {
      await patchclassService.createPatchclass('device-rule-test');
    });

    test('add and remove device rule', async () => {
      const rule = {
        name: 'Intel I219-LM NIC',
        category: 'nic',
        match: { type: 'pci', vendor: '8086', device: '15bb' },
        drivers: ['Intel_NIC_I219'],
      };

      const map = await patchclassService.addDeviceRule('device-rule-test', rule);
      expect(map.deviceRules).toHaveLength(1);
      expect(map.deviceRules[0].name).toBe('Intel I219-LM NIC');

      const map2 = await patchclassService.removeDeviceRule('device-rule-test', 'Intel I219-LM NIC');
      expect(map2.deviceRules).toHaveLength(0);
    });

    test('add duplicate device rule throws 409', async () => {
      const rule = {
        name: 'Test Rule',
        category: 'nic',
        match: { type: 'pci', vendor: '8086', device: '15bb' },
        drivers: ['test-set'],
      };

      await patchclassService.addDeviceRule('device-rule-test', rule);
      await expect(patchclassService.addDeviceRule('device-rule-test', rule))
        .rejects.toThrow(/already exists/);
    });

    test('remove nonexistent device rule throws 404', async () => {
      await expect(patchclassService.removeDeviceRule('device-rule-test', 'Nonexistent'))
        .rejects.toThrow(/not found/);
    });

    test('device rule validates PCI ID format', async () => {
      const invalidRule = {
        name: 'Bad Rule',
        category: 'nic',
        match: { type: 'pci', vendor: 'ZZZZ', device: '15bb' },
        drivers: ['test'],
      };

      await expect(patchclassService.addDeviceRule('device-rule-test', invalidRule))
        .rejects.toThrow();
    });

    test('device rule supports USB type', async () => {
      const rule = {
        name: 'Intel BT',
        category: 'bluetooth',
        match: { type: 'usb', vendor: '8087', device: '0029' },
        drivers: ['Intel_BT'],
      };

      const map = await patchclassService.addDeviceRule('device-rule-test', rule);
      expect(map.deviceRules[0].match.type).toBe('usb');
    });

    test('device rule with subsystem IDs', async () => {
      const rule = {
        name: 'Dell I219-LM',
        category: 'nic',
        match: {
          type: 'pci', vendor: '8086', device: '15bb',
          subvendor: '1028', subdevice: '07a1',
        },
        drivers: ['Dell_Intel_I219'],
      };

      const map = await patchclassService.addDeviceRule('device-rule-test', rule);
      expect(map.deviceRules[0].match.subvendor).toBe('1028');
      expect(map.deviceRules[0].match.subdevice).toBe('07a1');
    });
  });

  // ===========================================================================
  // Rule Generation with Device Rules
  // ===========================================================================

  describe('regenerateRules() with device rules', () => {
    beforeEach(async () => {
      await patchclassService.createPatchclass('device-rules-gen');
    });

    test('generates match_device_drivers() for device rules', async () => {
      await patchclassService.updateDriverMap('device-rules-gen', {
        version: 1,
        defaultDrivers: ['_generic'],
        ignoredCategories: [],
        models: [],
        deviceRules: [{
          name: 'Intel I219-LM',
          category: 'nic',
          match: { type: 'pci', vendor: '8086', device: '15bb' },
          drivers: ['Intel_NIC_I219'],
        }],
      });

      const rules = await fs.readFile(
        path.join(TEST_PC_BASE, 'device-rules-gen', 'driver-rules.sh'), 'utf-8'
      );
      expect(rules).toContain('match_device_drivers()');
      expect(rules).toContain('"8086:15bb"');
      expect(rules).toContain('Intel_NIC_I219');
    });

    test('subsystem matches come before base matches', async () => {
      await patchclassService.updateDriverMap('device-rules-gen', {
        version: 1,
        defaultDrivers: ['_generic'],
        ignoredCategories: [],
        models: [],
        deviceRules: [
          {
            name: 'Intel I219 Generic',
            category: 'nic',
            match: { type: 'pci', vendor: '8086', device: '15bb' },
            drivers: ['Intel_NIC_I219'],
          },
          {
            name: 'Dell Intel I219',
            category: 'nic',
            match: {
              type: 'pci', vendor: '8086', device: '15bb',
              subvendor: '1028', subdevice: '07a1',
            },
            drivers: ['Dell_Intel_I219'],
          },
        ],
      });

      const rules = await fs.readFile(
        path.join(TEST_PC_BASE, 'device-rules-gen', 'driver-rules.sh'), 'utf-8'
      );

      // Subsystem match should appear before base match
      const subsystemIdx = rules.indexOf('8086:15bb:1028:07a1');
      const baseIdx = rules.indexOf('"8086:15bb")');
      expect(subsystemIdx).toBeGreaterThan(-1);
      expect(baseIdx).toBeGreaterThan(-1);
      expect(subsystemIdx).toBeLessThan(baseIdx);
    });

    test('ignoredCategories filters out rules', async () => {
      await patchclassService.updateDriverMap('device-rules-gen', {
        version: 1,
        defaultDrivers: ['_generic'],
        ignoredCategories: ['usb'],
        models: [],
        deviceRules: [
          {
            name: 'Intel NIC',
            category: 'nic',
            match: { type: 'pci', vendor: '8086', device: '15bb' },
            drivers: ['Intel_NIC'],
          },
          {
            name: 'Intel USB',
            category: 'usb',
            match: { type: 'pci', vendor: '8086', device: 'a36d' },
            drivers: ['Intel_USB'],
          },
        ],
      });

      const rules = await fs.readFile(
        path.join(TEST_PC_BASE, 'device-rules-gen', 'driver-rules.sh'), 'utf-8'
      );

      expect(rules).toContain('8086:15bb'); // NIC included
      expect(rules).not.toContain('a36d'); // USB filtered out
    });

    test('no match_device_drivers() when no device rules', async () => {
      await patchclassService.updateDriverMap('device-rules-gen', {
        version: 1,
        defaultDrivers: ['_generic'],
        models: [],
        deviceRules: [],
      });

      const rules = await fs.readFile(
        path.join(TEST_PC_BASE, 'device-rules-gen', 'driver-rules.sh'), 'utf-8'
      );

      expect(rules).not.toContain('match_device_drivers');
    });

    test('no match_device_drivers() when all rules are filtered', async () => {
      await patchclassService.updateDriverMap('device-rules-gen', {
        version: 1,
        defaultDrivers: ['_generic'],
        ignoredCategories: ['usb'],
        models: [],
        deviceRules: [{
          name: 'Filtered USB',
          category: 'usb',
          match: { type: 'pci', vendor: '8086', device: 'a36d' },
          drivers: ['Intel_USB'],
        }],
      });

      const rules = await fs.readFile(
        path.join(TEST_PC_BASE, 'device-rules-gen', 'driver-rules.sh'), 'utf-8'
      );

      expect(rules).not.toContain('match_device_drivers');
    });
  });

  // ===========================================================================
  // Schema backward compatibility
  // ===========================================================================

  describe('Schema backward compatibility', () => {
    test('old driver-map.json without deviceRules/ignoredCategories is valid', async () => {
      await patchclassService.createPatchclass('compat-test');
      // Write a legacy map without new fields
      const legacyMap = { version: 1, defaultDrivers: ['_generic'], models: [] };
      await fs.writeFile(
        path.join(TEST_PC_BASE, 'compat-test', 'driver-map.json'),
        JSON.stringify(legacyMap),
      );

      const map = await patchclassService.getDriverMap('compat-test');
      expect(map.deviceRules).toEqual([]);
      expect(map.ignoredCategories).toEqual([]);
    });
  });
});
