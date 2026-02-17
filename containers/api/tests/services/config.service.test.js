/**
 * LINBO Docker - Config Service Tests
 * Tests fuer start.conf Generierung und Deployment
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
      partitionId: 'ef',
      fsType: 'vfat',
      bootable: true,
      position: 1,
    },
    {
      device: '/dev/sda2',
      label: 'windows',
      size: '80G',
      partitionId: '7',
      fsType: 'ntfs',
      bootable: false,
      position: 2,
    },
    {
      device: '/dev/sda3',
      label: 'data',
      size: '',
      partitionId: '7',
      fsType: 'ntfs',
      bootable: false,
      position: 3,
    },
  ],
  osEntries: [
    {
      name: 'Windows 11',
      description: 'Windows 11 Pro Education',
      osType: 'windows',
      iconName: 'win11.png',
      baseImage: 'win11_pro_edu.qcow2',
      differentialImage: null,
      rootDevice: '/dev/sda2',
      root: '/dev/sda2',
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

    test('should include partition definitions with hex IDs', async () => {
      prisma.config.findUnique.mockResolvedValue(mockConfig);

      const result = await configService.generateStartConf(mockConfig.id);

      expect(result.content).toContain('Dev = /dev/sda1');
      expect(result.content).toContain('Label = efi');
      expect(result.content).toContain('Size = 512M');
      expect(result.content).toContain('Id = ef');
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

    test('should set Kernel = auto for Windows OS with empty kernel', async () => {
      prisma.config.findUnique.mockResolvedValue(mockConfig);

      const result = await configService.generateStartConf(mockConfig.id);

      expect(result.content).toContain('Kernel = auto');
    });

    test('should not override explicit kernel for Windows', async () => {
      const configWithKernel = {
        ...mockConfig,
        osEntries: [{
          ...mockConfig.osEntries[0],
          kernel: 'custom_kernel',
        }],
      };
      prisma.config.findUnique.mockResolvedValue(configWithKernel);

      const result = await configService.generateStartConf(mockConfig.id);

      expect(result.content).toContain('Kernel = custom_kernel');
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

    test('should not include header comments (production format)', async () => {
      prisma.config.findUnique.mockResolvedValue(mockConfig);

      const result = await configService.generateStartConf(mockConfig.id);

      // Production start.conf files do not have header comments
      expect(result.content).toMatch(/^\[LINBO\]/);
    });

    test('should emit GuiDisabled only when true', async () => {
      const configGuiDisabled = {
        ...mockConfig,
        linboSettings: { ...mockConfig.linboSettings, GuiDisabled: true },
      };
      prisma.config.findUnique.mockResolvedValue(configGuiDisabled);

      const result = await configService.generateStartConf(mockConfig.id);
      expect(result.content).toContain('GuiDisabled = yes');
    });

    test('should not emit GuiDisabled when false/no', async () => {
      prisma.config.findUnique.mockResolvedValue(mockConfig);

      const result = await configService.generateStartConf(mockConfig.id);
      expect(result.content).not.toContain('GuiDisabled');
    });

    test('should emit UseMinimalLayout only when true', async () => {
      const configMinimal = {
        ...mockConfig,
        linboSettings: { ...mockConfig.linboSettings, UseMinimalLayout: 'yes' },
      };
      prisma.config.findUnique.mockResolvedValue(configMinimal);

      const result = await configService.generateStartConf(mockConfig.id);
      expect(result.content).toContain('UseMinimalLayout = yes');
    });

    test('should emit named colors correctly', async () => {
      const configColors = {
        ...mockConfig,
        linboSettings: {
          ...mockConfig.linboSettings,
          BackgroundFontColor: 'white',
          ConsoleFontColorStdout: 'lightgreen',
          ConsoleFontColorStderr: 'orange',
        },
      };
      prisma.config.findUnique.mockResolvedValue(configColors);

      const result = await configService.generateStartConf(mockConfig.id);
      expect(result.content).toContain('BackgroundFontColor = white');
      expect(result.content).toContain('ConsoleFontColorStdout = lightgreen');
      expect(result.content).toContain('ConsoleFontColorStderr = orange');
    });
  });

  describe('parseStartConf', () => {
    test('should parse partition IDs as hex strings', () => {
      const content = `[LINBO]
Server = 10.0.0.1

[Partition]
Dev = /dev/sda1
Label = efi
Size = 512M
Id = ef
FSType = vfat
Bootable = yes

[Partition]
Dev = /dev/sda2
Label = msr
Size = 128M
Id = 0c01
FSType =
Bootable = no
`;

      const result = configService.parseStartConf(content);

      expect(result.partitions).toHaveLength(2);
      expect(result.partitions[0].partitionId).toBe('ef');
      expect(result.partitions[1].partitionId).toBe('0c01');
    });

    test('should strip 0x prefix and lowercase', () => {
      const content = `[Partition]
Dev = /dev/sda1
Id = 0xEF
FSType = vfat
Bootable = no
`;

      const result = configService.parseStartConf(content);
      expect(result.partitions[0].partitionId).toBe('ef');
    });

    test('should parse GuiDisabled and UseMinimalLayout', () => {
      const content = `[LINBO]
Server = 10.0.0.1
GuiDisabled = yes
UseMinimalLayout = yes
`;

      const result = configService.parseStartConf(content);
      expect(result.linboSettings.guidisabled).toBe(true);
      expect(result.linboSettings.useminimallayout).toBe(true);
    });

    test('should parse named colors as strings', () => {
      const content = `[LINBO]
Server = 10.0.0.1
BackgroundFontColor = white
ConsoleFontColorStdout = lightgreen
ConsoleFontColorStderr = orange
`;

      const result = configService.parseStartConf(content);
      expect(result.linboSettings.backgroundfontcolor).toBe('white');
      expect(result.linboSettings.consolefontcolorstdout).toBe('lightgreen');
      expect(result.linboSettings.consolefontcolorstderr).toBe('orange');
    });

    test('should parse cache fsType correctly', () => {
      const content = `[Partition]
Dev = /dev/sda4
Label = cache
Size =
Id = 83
FSType = cache
Bootable = no
`;

      const result = configService.parseStartConf(content);
      expect(result.partitions[0].fsType).toBe('cache');
    });

    test('should parse Windows OS with Kernel = auto', () => {
      const content = `[OS]
Name = Windows 10
Version = 22H2
Kernel = auto
Initrd =
Boot = /dev/sda2
Root = /dev/sda2
StartEnabled = yes
SyncEnabled = yes
NewEnabled = yes
Autostart = no
AutostartTimeout = 5
DefaultAction = sync
Hidden = no
`;

      const result = configService.parseStartConf(content);
      expect(result.osEntries).toHaveLength(1);
      expect(result.osEntries[0].kernel).toBe('auto');
      expect(result.osEntries[0].rootDevice).toBe('/dev/sda2');
      expect(result.osEntries[0].root).toBe('/dev/sda2');
    });
  });

  describe('round-trip: parse → generate', () => {
    test('hex ID 0c01 round-trip', () => {
      const content = `[Partition]
Dev = /dev/sda2
Label = msr
Size = 128M
Id = 0c01
FSType =
Bootable = no
`;

      const parsed = configService.parseStartConf(content);
      expect(parsed.partitions[0].partitionId).toBe('0c01');

      // Simulate what generateStartConf would do via toHexId
      // (we test toHexId indirectly through generate)
    });

    test('full EFI Windows config round-trip', async () => {
      const originalContent = `[LINBO]
Server = 10.0.0.1
Group = win10_efi
Cache = /dev/sda4
RootTimeout = 600
AutoPartition = no
AutoFormat = no
AutoInitCache = no
DownloadType = torrent
BackgroundFontColor = white
ConsoleFontColorStdout = lightgreen
ConsoleFontColorStderr = orange
SystemType = efi64
KernelOptions = quiet
clientDetailsVisibleByDefault = yes
Locale = de-de

[Partition]
Dev = /dev/sda1
Label = efi
Size = 512M
Id = ef
FSType = vfat
Bootable = yes

[Partition]
Dev = /dev/sda2
Label = msr
Size = 128M
Id = 0c01
FSType =
Bootable = no

[Partition]
Dev = /dev/sda3
Label = windows
Size = 80G
Id = 7
FSType = ntfs
Bootable = no

[Partition]
Dev = /dev/sda4
Label = cache
Size =
Id = 83
FSType = cache
Bootable = no

[OS]
Name = Windows 10
Version = 22H2
Description = Windows 10 Pro
IconName = win10.svg
Image =
BaseImage = win10_pro.qcow2
Boot = /dev/sda3
Root = /dev/sda3
Kernel = auto
Initrd =
Append =
StartEnabled = yes
SyncEnabled = yes
NewEnabled = yes
Autostart = no
AutostartTimeout = 5
DefaultAction = sync
RestoreOpsiState = no
ForceOpsiSetup =
Hidden = no
`;

      // Parse
      const parsed = configService.parseStartConf(originalContent);

      // Verify parsed data
      expect(parsed.partitions).toHaveLength(4);
      expect(parsed.partitions[0].partitionId).toBe('ef');
      expect(parsed.partitions[1].partitionId).toBe('0c01');
      expect(parsed.partitions[2].partitionId).toBe('7');
      expect(parsed.partitions[3].partitionId).toBe('83');
      expect(parsed.partitions[3].fsType).toBe('cache');

      expect(parsed.osEntries).toHaveLength(1);
      expect(parsed.osEntries[0].kernel).toBe('auto');
      expect(parsed.osEntries[0].rootDevice).toBe('/dev/sda3');
      expect(parsed.osEntries[0].root).toBe('/dev/sda3');

      // Re-generate from parsed data
      const mockDbConfig = {
        id: 'test-roundtrip',
        name: 'win10_efi',
        linboSettings: parsed.linboSettings,
        partitions: parsed.partitions,
        osEntries: parsed.osEntries,
      };
      prisma.config.findUnique.mockResolvedValue(mockDbConfig);

      const generated = await configService.generateStartConf('test-roundtrip');

      // Verify key fields survived the round-trip
      expect(generated.content).toContain('Id = ef');
      expect(generated.content).toContain('Id = 0c01');
      expect(generated.content).toContain('Id = 7');
      expect(generated.content).toContain('Id = 83');
      expect(generated.content).toContain('FSType = cache');
      expect(generated.content).toContain('Kernel = auto');
      expect(generated.content).toContain('Boot = /dev/sda3');
      expect(generated.content).toContain('Root = /dev/sda3');
      expect(generated.content).toContain('BackgroundFontColor = white');
      expect(generated.content).toContain('ConsoleFontColorStdout = lightgreen');
      expect(generated.content).toContain('ConsoleFontColorStderr = orange');
      expect(generated.content).toContain('SystemType = efi64');
      expect(generated.content).toContain('Locale = de-de');

      // Re-parse the generated output
      const reParsed = configService.parseStartConf(generated.content);

      // Verify round-trip consistency
      expect(reParsed.partitions).toHaveLength(4);
      expect(reParsed.partitions[0].partitionId).toBe('ef');
      expect(reParsed.partitions[1].partitionId).toBe('0c01');
      expect(reParsed.partitions[2].partitionId).toBe('7');
      expect(reParsed.partitions[3].partitionId).toBe('83');
      expect(reParsed.osEntries[0].kernel).toBe('auto');
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
      };
      prisma.config.findUnique.mockResolvedValue(configWithHosts);

      const count = await configService.createHostSymlinks(mockConfig.id);

      expect(count).toBe(2);

      // Check symlinks exist
      const link1 = await fs.readlink(path.join(TEST_DIR, 'start.conf-10.0.0.101'));
      expect(link1).toBe('start.conf.win11_efi_sata');
    });

    test('should create symlinks for multiple hosts', async () => {
      const configWithHosts = {
        ...mockConfig,
        hosts: [
          { ipAddress: '10.0.0.201' },
          { ipAddress: '10.0.0.202' },
        ],
      };
      prisma.config.findUnique.mockResolvedValue(configWithHosts);

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
