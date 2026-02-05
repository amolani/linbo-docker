/**
 * LINBO Docker - GRUB Service Tests
 * Tests für GRUB-Konfigurationsgenerierung
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// Set environment before importing service
const TEST_DIR = path.join(os.tmpdir(), `linbo-grub-test-${Date.now()}`);
process.env.LINBO_DIR = TEST_DIR;

// Mock Prisma
jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    hostGroup: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    host: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

const { prisma } = require('../../src/lib/prisma');
const grubService = require('../../src/services/grub.service');

// Test fixtures
const mockGroup = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  name: 'win11_efi_sata',
  defaultConfig: {
    linboSettings: {
      KernelOptions: 'quiet splash',
    },
    osEntries: [
      { name: 'Windows 11', position: 1 },
    ],
  },
};

const mockHost = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  hostname: 'pc-r101-01',
  config: {
    linboSettings: {
      KernelOptions: 'quiet splash debug',
    },
    osEntries: [
      { name: 'Windows 11', position: 1 },
    ],
  },
};

describe('GRUB Service', () => {
  const grubDir = path.join(TEST_DIR, 'boot/grub');
  const hostcfgDir = path.join(grubDir, 'hostcfg');

  beforeAll(async () => {
    await fs.mkdir(grubDir, { recursive: true });
    await fs.mkdir(hostcfgDir, { recursive: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  describe('generateGroupGrubConfig', () => {
    test('should generate valid GRUB config for group', async () => {
      prisma.hostGroup.findFirst.mockResolvedValue(mockGroup);

      const result = await grubService.generateGroupGrubConfig('win11_efi_sata');

      expect(result.content).toContain('# GRUB config for group: win11_efi_sata');
      expect(result.content).toContain('set group="win11_efi_sata"');
      expect(result.content).toContain('linux /linbo64');
      expect(result.content).toContain('initrd /linbofs64');
      expect(result.content).toContain('boot');
    });

    test('should include kernel options from config', async () => {
      prisma.hostGroup.findFirst.mockResolvedValue(mockGroup);

      const result = await grubService.generateGroupGrubConfig('win11_efi_sata');

      expect(result.content).toContain('quiet splash');
    });

    test('should write file to correct location', async () => {
      prisma.hostGroup.findFirst.mockResolvedValue(mockGroup);

      const result = await grubService.generateGroupGrubConfig('win11_efi_sata');

      expect(result.filepath).toContain('win11_efi_sata.cfg');

      const fileExists = await fs.access(result.filepath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });

    test('should handle group without config', async () => {
      prisma.hostGroup.findFirst.mockResolvedValue({
        ...mockGroup,
        defaultConfig: null,
      });

      const result = await grubService.generateGroupGrubConfig('win11_efi_sata');

      expect(result.content).toContain('set group="win11_efi_sata"');
      expect(result.content).toContain('linux /linbo64');
    });

    test('should include GRUB modules', async () => {
      prisma.hostGroup.findFirst.mockResolvedValue(mockGroup);

      const result = await grubService.generateGroupGrubConfig('win11_efi_sata');

      expect(result.content).toContain('insmod gzio');
      expect(result.content).toContain('insmod part_gpt');
      expect(result.content).toContain('insmod ext2');
      expect(result.content).toContain('insmod all_video');
    });
  });

  describe('generateHostGrubConfig', () => {
    test('should generate valid GRUB config for host', async () => {
      prisma.host.findFirst.mockResolvedValue(mockHost);

      const result = await grubService.generateHostGrubConfig('pc-r101-01', 'win11_efi_sata');

      expect(result.content).toContain('# GRUB config for host: pc-r101-01');
      expect(result.content).toContain('set hostname="pc-r101-01"');
      expect(result.content).toContain('set group="win11_efi_sata"');
    });

    test('should include kernel options from host config', async () => {
      prisma.host.findFirst.mockResolvedValue(mockHost);

      const result = await grubService.generateHostGrubConfig('pc-r101-01', 'win11_efi_sata');

      expect(result.content).toContain('quiet splash debug');
    });

    test('should write file to hostcfg directory', async () => {
      prisma.host.findFirst.mockResolvedValue(mockHost);

      const result = await grubService.generateHostGrubConfig('pc-r101-01', 'win11_efi_sata');

      expect(result.filepath).toContain('hostcfg');
      expect(result.filepath).toContain('pc-r101-01.cfg');

      const fileExists = await fs.access(result.filepath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });

    test('should use options if no host config exists', async () => {
      prisma.host.findFirst.mockResolvedValue({ ...mockHost, config: null });

      const result = await grubService.generateHostGrubConfig('pc-r101-01', 'win11_efi_sata', {
        kernelOptions: 'custom_option',
      });

      expect(result.content).toContain('custom_option');
    });
  });

  describe('generateMainGrubConfig', () => {
    test('should generate main grub.cfg', async () => {
      const result = await grubService.generateMainGrubConfig();

      expect(result.content).toContain('# LINBO Docker - Main GRUB Configuration');
      expect(result.content).toContain('set timeout=0');
      expect(result.content).toContain('set default=0');
    });

    test('should include host-specific config lookup', async () => {
      const result = await grubService.generateMainGrubConfig();

      expect(result.content).toContain('if [ -f $prefix/hostcfg/$hostname.cfg ]');
      expect(result.content).toContain('source $prefix/hostcfg/$hostname.cfg');
    });

    test('should include group config fallback', async () => {
      const result = await grubService.generateMainGrubConfig();

      expect(result.content).toContain('elif [ -n "$group" ] && [ -f $prefix/$group.cfg ]');
      expect(result.content).toContain('source $prefix/$group.cfg');
    });

    test('should include direct boot fallback', async () => {
      const result = await grubService.generateMainGrubConfig();

      expect(result.content).toContain('else');
      expect(result.content).toContain('linux /linbo64');
      expect(result.content).toContain('initrd /linbofs64');
    });

    test('should write file to grub directory', async () => {
      const result = await grubService.generateMainGrubConfig();

      expect(result.filepath).toContain('grub.cfg');

      const fileExists = await fs.access(result.filepath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });
  });

  describe('regenerateAllGrubConfigs', () => {
    test('should regenerate configs for all groups and hosts', async () => {
      prisma.hostGroup.findMany.mockResolvedValue([
        {
          name: 'group1',
          hosts: [
            { hostname: 'host1' },
            { hostname: 'host2' },
          ],
          defaultConfig: mockGroup.defaultConfig,
        },
        {
          name: 'group2',
          hosts: [],
          defaultConfig: null,
        },
      ]);
      prisma.hostGroup.findFirst.mockResolvedValue(mockGroup);
      prisma.host.findFirst.mockResolvedValue(mockHost);
      prisma.host.findMany.mockResolvedValue([]);

      const result = await grubService.regenerateAllGrubConfigs();

      expect(result.groups).toBe(2);
      expect(result.hosts).toBe(2);
      expect(result.configs.length).toBeGreaterThan(0);
    });

    test('should handle orphaned hosts', async () => {
      prisma.hostGroup.findMany.mockResolvedValue([]);
      prisma.host.findFirst.mockResolvedValue(mockHost);
      prisma.host.findMany.mockResolvedValue([
        { hostname: 'orphan1' },
        { hostname: 'orphan2' },
      ]);

      const result = await grubService.regenerateAllGrubConfigs();

      expect(result.hosts).toBe(2);
      expect(result.configs.some(c => c.group === 'default')).toBe(true);
    });

    test('should include main config in results', async () => {
      prisma.hostGroup.findMany.mockResolvedValue([]);
      prisma.host.findMany.mockResolvedValue([]);

      const result = await grubService.regenerateAllGrubConfigs();

      expect(result.configs.some(c => c.type === 'main')).toBe(true);
    });
  });

  describe('deleteGroupGrubConfig', () => {
    test('should delete group config file', async () => {
      // Create file first
      const filepath = path.join(grubDir, 'testgroup.cfg');
      await fs.writeFile(filepath, '# test');

      const deleted = await grubService.deleteGroupGrubConfig('testgroup');

      expect(deleted).toBe(true);

      const fileExists = await fs.access(filepath).then(() => true).catch(() => false);
      expect(fileExists).toBe(false);
    });

    test('should return false if file does not exist', async () => {
      const deleted = await grubService.deleteGroupGrubConfig('nonexistent');

      expect(deleted).toBe(false);
    });
  });

  describe('deleteHostGrubConfig', () => {
    test('should delete host config file', async () => {
      // Create file first
      const filepath = path.join(hostcfgDir, 'testhost.cfg');
      await fs.writeFile(filepath, '# test');

      const deleted = await grubService.deleteHostGrubConfig('testhost');

      expect(deleted).toBe(true);

      const fileExists = await fs.access(filepath).then(() => true).catch(() => false);
      expect(fileExists).toBe(false);
    });
  });

  describe('listGrubConfigs', () => {
    test('should list all GRUB configs', async () => {
      // Create test files
      await fs.writeFile(path.join(grubDir, 'group1.cfg'), '# test');
      await fs.writeFile(path.join(grubDir, 'group2.cfg'), '# test');
      await fs.writeFile(path.join(hostcfgDir, 'host1.cfg'), '# test');

      const result = await grubService.listGrubConfigs();

      expect(result.groups).toContain('group1');
      expect(result.groups).toContain('group2');
      expect(result.hosts).toContain('host1');
    });

    test('should exclude grub.cfg from groups list', async () => {
      await fs.writeFile(path.join(grubDir, 'grub.cfg'), '# main');

      const result = await grubService.listGrubConfigs();

      expect(result.groups).not.toContain('grub');
    });
  });

  describe('cleanupOrphanedConfigs', () => {
    test('should remove configs for non-existent groups', async () => {
      // Create orphaned config
      await fs.writeFile(path.join(grubDir, 'orphangroup.cfg'), '# test');

      prisma.hostGroup.findMany.mockResolvedValue([{ name: 'existinggroup' }]);
      prisma.host.findMany.mockResolvedValue([]);

      const result = await grubService.cleanupOrphanedConfigs();

      expect(result.removedGroups).toContain('orphangroup');
    });

    test('should remove configs for non-existent hosts', async () => {
      // Create orphaned host config
      await fs.writeFile(path.join(hostcfgDir, 'orphanhost.cfg'), '# test');

      prisma.hostGroup.findMany.mockResolvedValue([]);
      prisma.host.findMany.mockResolvedValue([{ hostname: 'existinghost' }]);

      const result = await grubService.cleanupOrphanedConfigs();

      expect(result.removedHosts).toContain('orphanhost');
    });

    test('should not remove configs for existing entities', async () => {
      // Create valid config
      await fs.writeFile(path.join(grubDir, 'validgroup.cfg'), '# test');

      prisma.hostGroup.findMany.mockResolvedValue([{ name: 'validgroup' }]);
      prisma.host.findMany.mockResolvedValue([]);

      const result = await grubService.cleanupOrphanedConfigs();

      expect(result.removedGroups).not.toContain('validgroup');

      const fileExists = await fs.access(path.join(grubDir, 'validgroup.cfg'))
        .then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });
  });
});
