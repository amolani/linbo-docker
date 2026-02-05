/**
 * LINBO Docker - Config Service Tests
 * Tests für start.conf Generierung und Deployment
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// Set environment before importing service
const TEST_DIR = path.join(os.tmpdir(), `linbo-config-test-${Date.now()}`);
process.env.LINBO_DIR = TEST_DIR;

// Mock Prisma
jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    config: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    host: {
      findMany: jest.fn(),
    },
  },
}));

const { prisma } = require('../../src/lib/prisma');
const configService = require('../../src/services/config.service');

// Test fixtures
const mockConfig = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  name: 'win11_efi_sata',
  version: 1,
  status: 'active',
  linboSettings: {
    Cache: '/dev/sda4',
    Server: '10.0.0.1',
    RootTimeout: 600,
    AutoPartition: 'no',
    AutoFormat: 'no',
    AutoInitCache: 'no',
    DownloadType: 'torrent',
    GuiDisabled: 'no',
    Locale: 'de-de',
    SystemType: 'efi64',
  },
  partitions: [
    {
      device: '/dev/sda1',
      label: 'efi',
      size: '512M',
      partitionId: 'ef00',
      fsType: 'vfat',
      bootable: true,
      position: 1,
    },
    {
      device: '/dev/sda2',
      label: 'windows',
      size: '80G',
      partitionId: '0700',
      fsType: 'ntfs',
      bootable: false,
      position: 2,
    },
    {
      device: '/dev/sda3',
      label: 'data',
      size: '',
      partitionId: '0700',
      fsType: 'ntfs',
      bootable: false,
      position: 3,
    },
  ],
  osEntries: [
    {
      name: 'Windows 11',
      description: 'Windows 11 Pro Education',
      iconName: 'win11.png',
      baseImage: 'win11_pro_edu.qcow2',
      differentialImage: null,
      rootDevice: '/dev/sda2',
      kernel: '',
      initrd: '',
      append: [],
      startEnabled: true,
      syncEnabled: true,
      newEnabled: true,
      autostart: false,
      autostartTimeout: 5,
      defaultAction: 'sync',
      position: 1,
    },
  ],
  hosts: [],
  hostGroups: [],
};

describe('Config Service', () => {
  beforeAll(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateStartConf', () => {
    test('should generate valid start.conf content', async () => {
      prisma.config.findUnique.mockResolvedValue(mockConfig);

      const result = await configService.generateStartConf(mockConfig.id);

      expect(result.content).toBeDefined();
      expect(result.content).toContain('[LINBO]');
      expect(result.content).toContain('[Partition]');
      expect(result.content).toContain('[OS]');
      expect(result.config).toEqual(mockConfig);
    });

    test('should include LINBO settings', async () => {
      prisma.config.findUnique.mockResolvedValue(mockConfig);

      const result = await configService.generateStartConf(mockConfig.id);

      expect(result.content).toContain('Cache = /dev/sda4');
      expect(result.content).toContain('Server = 10.0.0.1');
      expect(result.content).toContain('DownloadType = torrent');
      expect(result.content).toContain('SystemType = efi64');
    });

    test('should include partition definitions', async () => {
      prisma.config.findUnique.mockResolvedValue(mockConfig);

      const result = await configService.generateStartConf(mockConfig.id);

      expect(result.content).toContain('Dev = /dev/sda1');
      expect(result.content).toContain('Label = efi');
      expect(result.content).toContain('Size = 512M');
      expect(result.content).toContain('FSType = vfat');
      expect(result.content).toContain('Bootable = yes');
    });

    test('should include OS definitions', async () => {
      prisma.config.findUnique.mockResolvedValue(mockConfig);

      const result = await configService.generateStartConf(mockConfig.id);

      expect(result.content).toContain('Name = Windows 11');
      expect(result.content).toContain('Description = Windows 11 Pro Education');
      expect(result.content).toContain('BaseImage = win11_pro_edu.qcow2');
      expect(result.content).toContain('StartEnabled = yes');
      expect(result.content).toContain('SyncEnabled = yes');
    });

    test('should throw error for non-existent config', async () => {
      prisma.config.findUnique.mockResolvedValue(null);

      await expect(
        configService.generateStartConf('non-existent-id')
      ).rejects.toThrow('Configuration not found');
    });

    test('should use default values for missing settings', async () => {
      const configWithDefaults = {
        ...mockConfig,
        linboSettings: {},
      };
      prisma.config.findUnique.mockResolvedValue(configWithDefaults);

      const result = await configService.generateStartConf(mockConfig.id);

      expect(result.content).toContain('Cache = /dev/sda4');
      expect(result.content).toContain('RootTimeout = 600');
      expect(result.content).toContain('AutoPartition = no');
    });

    test('should include header comment with timestamp', async () => {
      prisma.config.findUnique.mockResolvedValue(mockConfig);

      const result = await configService.generateStartConf(mockConfig.id);

      expect(result.content).toContain('# LINBO start.conf - win11_efi_sata');
      expect(result.content).toContain('# Generated:');
      expect(result.content).toContain('# Version: 1');
    });
  });

  describe('deployConfig', () => {
    test('should deploy config file with correct name', async () => {
      prisma.config.findUnique.mockResolvedValue(mockConfig);

      const result = await configService.deployConfig(mockConfig.id);

      expect(result.filepath).toContain('start.conf.win11_efi_sata');
      expect(result.hash).toBeDefined();
      expect(result.hash).toHaveLength(32); // MD5 hash length
      expect(result.size).toBeGreaterThan(0);
    });

    test('should create MD5 hash file', async () => {
      prisma.config.findUnique.mockResolvedValue(mockConfig);

      await configService.deployConfig(mockConfig.id);

      const hashFile = path.join(TEST_DIR, 'start.conf.win11_efi_sata.md5');
      const hash = await fs.readFile(hashFile, 'utf8');
      expect(hash).toHaveLength(32);
    });

    test('should create backup of existing config', async () => {
      prisma.config.findUnique.mockResolvedValue(mockConfig);

      // Deploy twice
      await configService.deployConfig(mockConfig.id);

      // Modify config slightly
      const modifiedConfig = {
        ...mockConfig,
        linboSettings: { ...mockConfig.linboSettings, Cache: '/dev/sda5' },
      };
      prisma.config.findUnique.mockResolvedValue(modifiedConfig);
      await configService.deployConfig(mockConfig.id);

      const backupFile = path.join(TEST_DIR, 'start.conf.win11_efi_sata.bak');
      const backupExists = await fs.access(backupFile).then(() => true).catch(() => false);
      expect(backupExists).toBe(true);
    });
  });

  describe('createHostSymlinks', () => {
    beforeEach(async () => {
      // Create base config file
      await fs.writeFile(path.join(TEST_DIR, 'start.conf.win11_efi_sata'), '# test');
    });

    test('should create IP-based symlinks for hosts', async () => {
      const configWithHosts = {
        ...mockConfig,
        hosts: [
          { ipAddress: '10.0.0.101' },
          { ipAddress: '10.0.0.102' },
        ],
        hostGroups: [],
      };
      prisma.config.findUnique.mockResolvedValue(configWithHosts);

      const count = await configService.createHostSymlinks(mockConfig.id);

      expect(count).toBe(2);

      // Check symlinks exist
      const link1 = await fs.readlink(path.join(TEST_DIR, 'start.conf-10.0.0.101'));
      expect(link1).toBe('start.conf.win11_efi_sata');
    });

    test('should include hosts from groups', async () => {
      const configWithGroups = {
        ...mockConfig,
        hosts: [],
        hostGroups: [
          {
            hosts: [
              { ipAddress: '10.0.0.201' },
              { ipAddress: '10.0.0.202' },
            ],
          },
        ],
      };
      prisma.config.findUnique.mockResolvedValue(configWithGroups);

      const count = await configService.createHostSymlinks(mockConfig.id);

      expect(count).toBe(2);
    });

    test('should handle hosts without IP address', async () => {
      const configWithMissingIP = {
        ...mockConfig,
        hosts: [
          { ipAddress: '10.0.0.103' },
          { ipAddress: null },
        ],
        hostGroups: [],
      };
      prisma.config.findUnique.mockResolvedValue(configWithMissingIP);

      const count = await configService.createHostSymlinks(mockConfig.id);

      expect(count).toBe(1);
    });
  });

  describe('cleanupOrphanedSymlinks', () => {
    beforeEach(async () => {
      // Create test files and symlink
      await fs.writeFile(path.join(TEST_DIR, 'start.conf.test'), '# test');
    });

    test('should remove orphaned symlinks', async () => {
      // Create orphaned symlink
      const orphanLink = path.join(TEST_DIR, 'start.conf-192.168.99.99');
      try { await fs.unlink(orphanLink); } catch (e) {}
      await fs.symlink('start.conf.test', orphanLink);

      prisma.host.findMany.mockResolvedValue([
        { ipAddress: '10.0.0.50' },
      ]);

      const count = await configService.cleanupOrphanedSymlinks();

      expect(count).toBeGreaterThanOrEqual(1);
    });

    test('should not remove symlinks for active hosts', async () => {
      // Create active symlink
      const activeLink = path.join(TEST_DIR, 'start.conf-10.0.0.50');
      try { await fs.unlink(activeLink); } catch (e) {}
      await fs.symlink('start.conf.test', activeLink);

      prisma.host.findMany.mockResolvedValue([
        { ipAddress: '10.0.0.50' },
      ]);

      await configService.cleanupOrphanedSymlinks();

      const linkExists = await fs.access(activeLink)
        .then(() => true).catch(() => false);
      expect(linkExists).toBe(true);
    });
  });

  describe('listDeployedConfigs', () => {
    beforeEach(async () => {
      // Create test config files
      await fs.writeFile(path.join(TEST_DIR, 'start.conf.listtest1'), '# config 1');
      await fs.writeFile(path.join(TEST_DIR, 'start.conf.listtest1.md5'), 'abc123');
      await fs.writeFile(path.join(TEST_DIR, 'start.conf.listtest2'), '# config 2');
    });

    test('should list all deployed configs', async () => {
      const configs = await configService.listDeployedConfigs();

      expect(configs.length).toBeGreaterThanOrEqual(2);
      expect(configs.find(c => c.groupName === 'listtest1')).toBeDefined();
      expect(configs.find(c => c.groupName === 'listtest2')).toBeDefined();
    });

    test('should include MD5 hash when available', async () => {
      const configs = await configService.listDeployedConfigs();

      const config1 = configs.find(c => c.groupName === 'listtest1');
      expect(config1.hash).toBe('abc123');

      const config2 = configs.find(c => c.groupName === 'listtest2');
      // Hash is null or undefined when no .md5 file exists
      expect(config2.hash == null).toBe(true);
    });

    test('should include file metadata', async () => {
      const configs = await configService.listDeployedConfigs();

      const testConfigs = configs.filter(c => c.groupName.startsWith('listtest'));
      testConfigs.forEach(config => {
        expect(config.size).toBeGreaterThan(0);
        // modifiedAt is a Date but Jest serialization can cause issues
        expect(config.modifiedAt).toBeDefined();
        expect(config.filename).toMatch(/^start\.conf\./);
      });
    });
  });
});
