/**
 * LINBO Docker - GRUB Service Tests
 * Tests für GRUB-Konfigurationsgenerierung mit Templates und Symlinks
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// Set environment before importing service
const TEST_DIR = path.join(os.tmpdir(), `linbo-grub-test-${Date.now()}`);
process.env.LINBO_DIR = TEST_DIR;
process.env.LINBO_SERVER_IP = '10.0.0.1';
process.env.WEB_PORT = '8080';

// Mock Prisma
jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    config: {
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
const mockPartitions = [
  { device: '/dev/sda1', label: 'EFI', size: '512M', partitionId: 'ef00', fsType: 'vfat', position: 1 },
  { device: '/dev/sda2', label: 'windows', size: '100G', partitionId: '0700', fsType: 'ntfs', position: 2 },
  { device: '/dev/sda3', label: 'cache', size: '50G', partitionId: '8300', fsType: 'ext4', position: 3 },
];

const mockOsEntries = [
  {
    name: 'Windows 11 Pro',
    root: '/dev/sda2',
    kernel: '/boot/vmlinuz',
    initrd: '/boot/initrd.img',
    append: '',
    position: 1,
  },
];

const mockConfig = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  name: 'win11_efi_sata',
  linboSettings: {
    KernelOptions: 'quiet splash',
    Server: '10.0.0.11',
  },
  partitions: mockPartitions,
  osEntries: mockOsEntries,
};

const mockHost = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  hostname: 'pc-r101-01',
  config: { name: 'win11_efi_sata' },
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

  // ==========================================================================
  // Helper Function Tests
  // ==========================================================================

  describe('getGrubPart', () => {
    test('should convert SATA devices correctly', () => {
      expect(grubService.getGrubPart('/dev/sda1')).toBe('(hd0,1)');
      expect(grubService.getGrubPart('/dev/sda3')).toBe('(hd0,3)');
      expect(grubService.getGrubPart('/dev/sdb2')).toBe('(hd1,2)');
      expect(grubService.getGrubPart('/dev/sdc5')).toBe('(hd2,5)');
    });

    test('should convert NVMe devices correctly', () => {
      expect(grubService.getGrubPart('/dev/nvme0n1p1')).toBe('(hd0,1)');
      expect(grubService.getGrubPart('/dev/nvme0n1p3')).toBe('(hd0,3)');
      expect(grubService.getGrubPart('/dev/nvme1n1p2')).toBe('(hd1,2)');
    });

    test('should convert eMMC devices correctly', () => {
      expect(grubService.getGrubPart('/dev/mmcblk0p1')).toBe('(hd0,1)');
      expect(grubService.getGrubPart('/dev/mmcblk0p2')).toBe('(hd0,2)');
      expect(grubService.getGrubPart('/dev/mmcblk1p3')).toBe('(hd1,3)');
    });

    test('should convert virtio devices correctly', () => {
      expect(grubService.getGrubPart('/dev/vda1')).toBe('(hd0,1)');
      expect(grubService.getGrubPart('/dev/vdb2')).toBe('(hd1,2)');
    });

    test('should return default for null/undefined', () => {
      expect(grubService.getGrubPart(null)).toBe('(hd0,1)');
      expect(grubService.getGrubPart(undefined)).toBe('(hd0,1)');
      expect(grubService.getGrubPart('')).toBe('(hd0,1)');
    });

    // Uniform block device names (LINBO 4.3.5+)
    test('should convert uniform device disk0p1', () => {
      expect(grubService.getGrubPart('/dev/disk0p1')).toBe('(hd0,1)');
    });
    test('should convert uniform device disk0p3', () => {
      expect(grubService.getGrubPart('/dev/disk0p3')).toBe('(hd0,3)');
    });
    test('should convert uniform second disk', () => {
      expect(grubService.getGrubPart('/dev/disk1p2')).toBe('(hd1,2)');
    });
    test('should convert uniform double-digit partition', () => {
      expect(grubService.getGrubPart('/dev/disk0p10')).toBe('(hd0,10)');
    });
    test('should reject disk0p0 (invalid)', () => {
      expect(grubService.getGrubPart('/dev/disk0p0')).toBe('(hd0,1)'); // fallback
    });
    test('should reject bare disk0 (no partition)', () => {
      expect(grubService.getGrubPart('/dev/disk0')).toBe('(hd0,1)'); // fallback
    });
  });

  describe('getGrubOstype', () => {
    test('should detect Windows versions', () => {
      expect(grubService.getGrubOstype('Windows 11 Pro')).toBe('win11');
      expect(grubService.getGrubOstype('Windows 11 Education')).toBe('win11');
      expect(grubService.getGrubOstype('Windows 10 Enterprise')).toBe('win10');
      expect(grubService.getGrubOstype('Win10 LTSC')).toBe('win10');
      expect(grubService.getGrubOstype('Windows 8.1')).toBe('win8');
      expect(grubService.getGrubOstype('Windows 7 Professional')).toBe('win7');
      expect(grubService.getGrubOstype('Windows Server 2019')).toBe('windows');
    });

    test('should detect Linux distributions', () => {
      expect(grubService.getGrubOstype('Ubuntu 22.04 LTS')).toBe('ubuntu');
      expect(grubService.getGrubOstype('Debian 12 Bookworm')).toBe('debian');
      expect(grubService.getGrubOstype('Linux Mint 21')).toBe('linuxmint');
      expect(grubService.getGrubOstype('Fedora 39')).toBe('fedora');
      expect(grubService.getGrubOstype('openSUSE Tumbleweed')).toBe('opensuse');
      expect(grubService.getGrubOstype('Arch Linux')).toBe('arch');
      expect(grubService.getGrubOstype('Manjaro')).toBe('manjaro');
      expect(grubService.getGrubOstype('CentOS 7')).toBe('centos');
      expect(grubService.getGrubOstype('RHEL 8')).toBe('rhel');
    });

    test('should return unknown for unrecognized OS', () => {
      expect(grubService.getGrubOstype('FreeBSD 14')).toBe('unknown');
      expect(grubService.getGrubOstype('Custom OS')).toBe('unknown');
      expect(grubService.getGrubOstype(null)).toBe('unknown');
      expect(grubService.getGrubOstype(undefined)).toBe('unknown');
    });
  });

  describe('findCachePartition', () => {
    test('should find partition by label "cache"', () => {
      const result = grubService.findCachePartition(mockPartitions);
      expect(result.label).toBe('cache');
      expect(result.device).toBe('/dev/sda3');
    });

    test('should find ext4 partition as fallback', () => {
      const partitionsWithoutCacheLabel = [
        { device: '/dev/sda1', label: 'EFI', fsType: 'vfat', partitionId: 'ef00' },
        { device: '/dev/sda2', label: 'windows', fsType: 'ntfs', partitionId: '0700' },
        { device: '/dev/sda3', label: 'data', fsType: 'ext4', partitionId: '8300' },
      ];
      const result = grubService.findCachePartition(partitionsWithoutCacheLabel);
      expect(result.device).toBe('/dev/sda3');
    });

    test('should return null for empty array', () => {
      expect(grubService.findCachePartition([])).toBeNull();
      expect(grubService.findCachePartition(null)).toBeNull();
      expect(grubService.findCachePartition(undefined)).toBeNull();
    });
  });

  describe('getPartitionNumber', () => {
    test('should extract partition number from SATA device', () => {
      expect(grubService.getPartitionNumber('/dev/sda1')).toBe(1);
      expect(grubService.getPartitionNumber('/dev/sda5')).toBe(5);
      expect(grubService.getPartitionNumber('/dev/sdb12')).toBe(12);
    });

    test('should extract partition number from NVMe device', () => {
      expect(grubService.getPartitionNumber('/dev/nvme0n1p1')).toBe(1);
      expect(grubService.getPartitionNumber('/dev/nvme0n1p3')).toBe(3);
    });

    test('should return 1 for invalid input', () => {
      expect(grubService.getPartitionNumber(null)).toBe(1);
      expect(grubService.getPartitionNumber('')).toBe(1);
    });
  });

  describe('getOsPartitionIndex', () => {
    test('should return correct 1-based index', () => {
      expect(grubService.getOsPartitionIndex(mockPartitions, '/dev/sda1')).toBe(1);
      expect(grubService.getOsPartitionIndex(mockPartitions, '/dev/sda2')).toBe(2);
      expect(grubService.getOsPartitionIndex(mockPartitions, '/dev/sda3')).toBe(3);
    });

    test('should return 1 for unknown device', () => {
      expect(grubService.getOsPartitionIndex(mockPartitions, '/dev/sda99')).toBe(1);
    });

    test('should return 1 for null/undefined', () => {
      expect(grubService.getOsPartitionIndex(null, '/dev/sda1')).toBe(1);
      expect(grubService.getOsPartitionIndex(mockPartitions, null)).toBe(1);
    });
  });

  describe('applyTemplate', () => {
    test('should replace all placeholders', () => {
      const template = 'Hello @@name@@, welcome to @@place@@!';
      const result = grubService.applyTemplate(template, {
        name: 'World',
        place: 'LINBO',
      });
      expect(result).toBe('Hello World, welcome to LINBO!');
    });

    test('should handle multiple occurrences', () => {
      const template = '@@value@@ + @@value@@ = 2x@@value@@';
      const result = grubService.applyTemplate(template, { value: '5' });
      expect(result).toBe('5 + 5 = 2x5');
    });

    test('should handle null/undefined values', () => {
      const template = 'Value: @@test@@';
      const result = grubService.applyTemplate(template, { test: null });
      expect(result).toBe('Value: ');
    });
  });

  describe('getLinboSetting', () => {
    test('should find exact case match', () => {
      const settings = { KernelOptions: 'quiet splash' };
      expect(grubService.getLinboSetting(settings, 'KernelOptions')).toBe('quiet splash');
    });

    test('should find lowercase match', () => {
      const settings = { kerneloptions: 'quiet' };
      expect(grubService.getLinboSetting(settings, 'KernelOptions')).toBe('quiet');
    });

    test('should be case-insensitive', () => {
      const settings = { KERNELOPTIONS: 'value' };
      expect(grubService.getLinboSetting(settings, 'kernelOptions')).toBe('value');
    });

    test('should return undefined for missing key', () => {
      const settings = { other: 'value' };
      expect(grubService.getLinboSetting(settings, 'KernelOptions')).toBeUndefined();
    });

    test('should handle null settings', () => {
      expect(grubService.getLinboSetting(null, 'key')).toBeUndefined();
      expect(grubService.getLinboSetting(undefined, 'key')).toBeUndefined();
    });
  });

  // ==========================================================================
  // Config Generation Tests
  // ==========================================================================

  describe('generateConfigGrubConfig', () => {
    test('should generate valid GRUB config for group', async () => {
      prisma.config.findFirst.mockResolvedValue(mockConfig);

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      expect(result.content).toContain('# LINBO Docker - Group GRUB Configuration');
      expect(result.content).toContain('Group: win11_efi_sata');
      expect(result.content).toContain('insmod all_video');
      expect(result.content).toContain('insmod http');
    });

    test('should include kernel options from config', async () => {
      prisma.config.findFirst.mockResolvedValue(mockConfig);

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      expect(result.content).toContain('quiet splash');
      expect(result.content).toContain('server=10.0.0.11');
    });

    test('should include cache partition settings', async () => {
      prisma.config.findFirst.mockResolvedValue(mockConfig);

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      expect(result.content).toContain('set cachelabel="cache"');
      expect(result.content).toContain('(hd0,3)');
    });

    test('should use --no-floppy on search commands', async () => {
      prisma.config.findFirst.mockResolvedValue(mockConfig);

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      expect(result.content).toContain('search --no-floppy --label');
      expect(result.content).toContain('search --no-floppy --file /start.conf');
      expect(result.content).toContain('search --no-floppy --file "$linbo_initrd"');
    });

    test('should guard linbo_initrd search with -n check', async () => {
      prisma.config.findFirst.mockResolvedValue(mockConfig);

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      expect(result.content).toContain('[ -z "$cacheroot" -a -n "$linbo_initrd" ]');
    });

    test('should include net_default_server fallback for netboot', async () => {
      prisma.config.findFirst.mockResolvedValue(mockConfig);

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      expect(result.content).toContain('$pxe_default_server');
      expect(result.content).toContain('$net_default_server');
    });

    test('should set cfg_loaded=1 at end of global template', async () => {
      prisma.config.findFirst.mockResolvedValue(mockConfig);

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      expect(result.content).toContain('set cfg_loaded=1');
    });

    test('should use HTTP boot for netboot kernel/initrd loading', async () => {
      prisma.config.findFirst.mockResolvedValue(mockConfig);

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      // Global template: insmod http and http_root variable
      expect(result.content).toContain('insmod http');
      expect(result.content).toContain('set http_root="(http,10.0.0.11:8080)"');
      // Kernel/initrd loaded via http_root prefix
      expect(result.content).toContain('${http_root}$linbo_kernel');
      expect(result.content).toContain('${http_root}$linbo_initrd');
    });

    test('should pass server and httpport to OS template', async () => {
      prisma.config.findFirst.mockResolvedValue(mockConfig);

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      // OS entries should also have insmod http and http_root
      // Count insmod http: 1 in global + 3 in OS entries = 4
      const httpMatches = result.content.match(/insmod http\b/g);
      expect(httpMatches.length).toBe(4);

      // Count http_root definitions: 1 in global + 3 in OS = 4
      const httpRootMatches = result.content.match(/set http_root=".*8080.*"/g);
      expect(httpRootMatches.length).toBe(4);
    });

    test('should generate OS menu entries', async () => {
      prisma.config.findFirst.mockResolvedValue(mockConfig);

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      // Check for all 4 menu types
      expect(result.content).toContain("'Windows 11 Pro (Start)'");
      expect(result.content).toContain("'Windows 11 Pro (Linbo-Start)'");
      expect(result.content).toContain("'Windows 11 Pro (Sync+Start)'");
      expect(result.content).toContain("'Windows 11 Pro (Neu+Start)'");
    });

    test('should include linbocmd commands', async () => {
      prisma.config.findFirst.mockResolvedValue(mockConfig);

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      expect(result.content).toContain('linbocmd=start:1');
      expect(result.content).toContain('linbocmd=sync:1,start:1');
      expect(result.content).toContain('linbocmd=format:2,sync:1,start:1');
    });

    test('should write file to correct location', async () => {
      prisma.config.findFirst.mockResolvedValue(mockConfig);

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      expect(result.filepath).toContain('win11_efi_sata.cfg');

      const fileExists = await fs.access(result.filepath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });

    test('should handle group without config', async () => {
      prisma.config.findFirst.mockResolvedValue({
        ...mockConfig,
        linboSettings: null,
        partitions: [],
        osEntries: [],
      });

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      expect(result.content).toContain('Group: win11_efi_sata');
      // Should still have LINBO entry
      expect(result.content).toContain("menuentry 'LINBO'");
    });

    test('should use LINBO_SERVER_IP env as fallback when no Server in config', async () => {
      prisma.config.findFirst.mockResolvedValue({
        ...mockConfig,
        linboSettings: { KernelOptions: 'quiet' },
      });

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      // Server should come from env (10.0.0.1)
      expect(result.content).toContain('server=10.0.0.1');
    });

    test('should include GRUB modules', async () => {
      prisma.config.findFirst.mockResolvedValue(mockConfig);

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      expect(result.content).toContain('insmod all_video');
      expect(result.content).toContain('insmod http');
    });

    test('should include boot variables and cache settings', async () => {
      prisma.config.findFirst.mockResolvedValue(mockConfig);

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      expect(result.content).toContain('set linbo_kernel=/linbo64');
      expect(result.content).toContain('set linbo_initrd=/linbofs64');
      expect(result.content).toContain('set cachelabel=');
    });

    test('should include OS type class for icons', async () => {
      prisma.config.findFirst.mockResolvedValue(mockConfig);

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      expect(result.content).toContain('--class win11_start');
      expect(result.content).toContain('--class win11_syncstart');
      expect(result.content).toContain('--class win11_newstart');
    });

    test('should include net_default_server fallback in OS entries', async () => {
      prisma.config.findFirst.mockResolvedValue(mockConfig);

      const result = await grubService.generateConfigGrubConfig('win11_efi_sata');

      // Count occurrences of net_default_server in OS section
      // Should appear in Linbo-Start, Sync+Start, Neu+Start (3 times) + global (1 time) = 4
      const matches = result.content.match(/\$net_default_server/g);
      expect(matches.length).toBe(4);
    });
  });

  describe('generateHostGrubConfig (Symlinks)', () => {
    test('should create symlink instead of file', async () => {
      const result = await grubService.generateHostGrubConfig('pc-r101-01', 'win11_efi_sata');

      expect(result.isSymlink).toBe(true);
      expect(result.target).toBe('../win11_efi_sata.cfg');
    });

    test('should create symlink in hostcfg directory', async () => {
      const result = await grubService.generateHostGrubConfig('pc-r101-01', 'win11_efi_sata');

      expect(result.filepath).toContain('hostcfg');
      expect(result.filepath).toContain('pc-r101-01.cfg');
    });

    test('should verify symlink exists and is correct', async () => {
      await grubService.generateHostGrubConfig('test-symlink', 'testgroup');

      const filepath = path.join(hostcfgDir, 'test-symlink.cfg');
      const stat = await fs.lstat(filepath);
      expect(stat.isSymbolicLink()).toBe(true);

      const target = await fs.readlink(filepath);
      expect(target).toBe('../testgroup.cfg');
    });

    test('should replace existing file with symlink', async () => {
      // Create regular file first
      const filepath = path.join(hostcfgDir, 'replace-test.cfg');
      await fs.writeFile(filepath, '# old file content');

      await grubService.generateHostGrubConfig('replace-test', 'newgroup');

      const stat = await fs.lstat(filepath);
      expect(stat.isSymbolicLink()).toBe(true);

      const target = await fs.readlink(filepath);
      expect(target).toBe('../newgroup.cfg');
    });

    test('should replace existing symlink with different target', async () => {
      const filepath = path.join(hostcfgDir, 'update-symlink.cfg');

      // Create initial symlink
      await grubService.generateHostGrubConfig('update-symlink', 'oldgroup');

      // Update to new group
      await grubService.generateHostGrubConfig('update-symlink', 'newgroup');

      const target = await fs.readlink(filepath);
      expect(target).toBe('../newgroup.cfg');
    });
  });

  describe('generateMainGrubConfig', () => {
    beforeEach(() => {
      prisma.host.findMany.mockResolvedValue([]);
      prisma.config.findMany.mockResolvedValue([]);
    });

    test('should generate main grub.cfg', async () => {
      const result = await grubService.generateMainGrubConfig();

      expect(result.content).toContain('# LINBO Docker - Main PXE GRUB Configuration');
      expect(result.content).toContain('set timeout=0');
      expect(result.content).toContain('set default=0');
    });

    test('should include host-specific config lookup with hostname guard', async () => {
      const result = await grubService.generateMainGrubConfig();

      // Should guard hostname check with -n before file check
      expect(result.content).toContain('if [ -n "$net_default_hostname" ]');
      expect(result.content).toContain('source $prefix/hostcfg/$net_default_hostname.cfg');
    });

    test('should include hostname variable fallback', async () => {
      const result = await grubService.generateMainGrubConfig();

      expect(result.content).toContain('[ -z "$cfg_loaded" -a -n "$hostname" ]');
      expect(result.content).toContain('source $prefix/hostcfg/$hostname.cfg');
    });

    test('should include group config fallback with cfg_loaded guard', async () => {
      const result = await grubService.generateMainGrubConfig();

      expect(result.content).toContain('[ -z "$cfg_loaded" -a -n "$group" ]');
      expect(result.content).toContain('source "$groupcfg"');
    });

    test('should set cfg_loaded=1 after each source', async () => {
      const result = await grubService.generateMainGrubConfig();

      const matches = result.content.match(/set cfg_loaded=1/g);
      // 4 source blocks (net_default_hostname, net_pxe_hostname, hostname, group) = 4 cfg_loaded=1
      expect(matches.length).toBe(4);
    });

    test('should include direct boot fallback with HTTP and server from env', async () => {
      const result = await grubService.generateMainGrubConfig();

      expect(result.content).toContain('if [ -z "$cfg_loaded" ]');
      expect(result.content).toContain('insmod http');
      expect(result.content).toContain('set http_root="(http,10.0.0.1:8080)"');
      expect(result.content).toContain('linux ${http_root}$linbo_kernel quiet splash server=10.0.0.1');
      expect(result.content).toContain('initrd ${http_root}$linbo_initrd');
    });

    test('should use nested if instead of && in host/group config section', async () => {
      const result = await grubService.generateMainGrubConfig();

      // Host/group config loading section should use nested if, not elif or &&
      const configSection = result.content.split('# === NORMAL BOOT')[1]?.split('# MAC-based')[0] || '';
      expect(configSection).not.toContain('] && [');
      // Uses nested if [...]; then / if [ -f ... ]; then pattern
      expect(configSection).toContain('if [ -n "$net_default_hostname" ]');
      expect(configSection).toContain('if [ -z "$cfg_loaded" -a -n "$hostname" ]');
    });

    test('should write file to grub directory', async () => {
      const result = await grubService.generateMainGrubConfig();

      expect(result.filepath).toContain('grub.cfg');

      const fileExists = await fs.access(result.filepath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });
  });

  describe('regenerateAllGrubConfigs', () => {
    test('should regenerate configs for all configs and hosts', async () => {
      prisma.config.findMany.mockResolvedValue([
        {
          name: 'config1',
          hosts: [
            { hostname: 'host1' },
            { hostname: 'host2' },
          ],
          _count: { hosts: 2 },
          linboSettings: mockConfig.linboSettings,
          partitions: mockConfig.partitions,
          osEntries: mockConfig.osEntries,
        },
        {
          name: 'config2',
          hosts: [],
          _count: { hosts: 0 },
          linboSettings: {},
          partitions: [],
          osEntries: [],
        },
      ]);
      prisma.config.findFirst.mockResolvedValue(mockConfig);
      prisma.host.findMany.mockResolvedValue([]);

      const result = await grubService.regenerateAllGrubConfigs();

      expect(result.configs).toBeDefined();
      expect(result.hosts).toBe(2);
      expect(result.configs).toBe(2); // Number of config GRUB files generated
      expect(result.results.length).toBeGreaterThan(0);
    });

    test('should create symlinks for hosts', async () => {
      prisma.config.findMany.mockResolvedValue([
        {
          name: 'testconfig',
          hosts: [{ hostname: 'symlink-host' }],
          _count: { hosts: 1 },
          linboSettings: mockConfig.linboSettings,
          partitions: mockConfig.partitions,
          osEntries: mockConfig.osEntries,
        },
      ]);
      prisma.config.findFirst.mockResolvedValue(mockConfig);
      prisma.host.findMany.mockResolvedValue([]);

      const result = await grubService.regenerateAllGrubConfigs();

      // Check host result indicates symlink
      const hostResult = result.results.find(c => c.name === 'symlink-host');
      expect(hostResult.isSymlink).toBe(true);
    });

    test('should handle orphaned hosts', async () => {
      prisma.config.findMany.mockResolvedValue([]);
      prisma.host.findMany.mockResolvedValue([
        { hostname: 'orphan1' },
        { hostname: 'orphan2' },
      ]);

      const result = await grubService.regenerateAllGrubConfigs();

      expect(result.hosts).toBe(2);
      expect(result.results.some(c => c.config === 'default')).toBe(true);
    });

    test('should include main config in results', async () => {
      prisma.config.findMany.mockResolvedValue([]);
      prisma.host.findMany.mockResolvedValue([]);

      const result = await grubService.regenerateAllGrubConfigs();

      expect(result.results.some(c => c.type === 'main')).toBe(true);
    });
  });

  describe('migrateHostConfigsToSymlinks', () => {
    test('should migrate regular files to symlinks', async () => {
      // Create regular file
      const filepath = path.join(hostcfgDir, 'migrate-test.cfg');
      await fs.writeFile(filepath, '# old content');

      prisma.host.findMany.mockResolvedValue([
        { hostname: 'migrate-test', config: { name: 'testgroup' } },
      ]);

      const result = await grubService.migrateHostConfigsToSymlinks();

      expect(result.migrated).toBe(1);

      // Verify symlink
      const stat = await fs.lstat(filepath);
      expect(stat.isSymbolicLink()).toBe(true);
    });

    test('should create backup of regular files', async () => {
      const filepath = path.join(hostcfgDir, 'backup-test.cfg');
      await fs.writeFile(filepath, '# backup content');

      prisma.host.findMany.mockResolvedValue([
        { hostname: 'backup-test', config: { name: 'testgroup' } },
      ]);

      await grubService.migrateHostConfigsToSymlinks();

      // Check backup exists
      const files = await fs.readdir(hostcfgDir);
      const backupFile = files.find(f => f.startsWith('backup-test.cfg.bak'));
      expect(backupFile).toBeDefined();
    });

    test('should count already-symlink files', async () => {
      // Create symlink first
      const filepath = path.join(hostcfgDir, 'already-symlink.cfg');
      try { await fs.unlink(filepath); } catch {}
      await fs.symlink('../testgroup.cfg', filepath);

      prisma.host.findMany.mockResolvedValue([
        { hostname: 'already-symlink', config: { name: 'testgroup' } },
      ]);

      const result = await grubService.migrateHostConfigsToSymlinks();

      expect(result.alreadySymlinks).toBe(1);
      expect(result.migrated).toBe(0);
    });

    test('should create symlink for missing hosts', async () => {
      prisma.host.findMany.mockResolvedValue([
        { hostname: 'new-host-migration', config: { name: 'testgroup' } },
      ]);

      const result = await grubService.migrateHostConfigsToSymlinks();

      expect(result.migrated).toBe(1);

      const filepath = path.join(hostcfgDir, 'new-host-migration.cfg');
      const stat = await fs.lstat(filepath);
      expect(stat.isSymbolicLink()).toBe(true);
    });
  });

  describe('deleteConfigGrubConfig', () => {
    test('should delete group config file', async () => {
      const filepath = path.join(grubDir, 'testgroup.cfg');
      await fs.writeFile(filepath, '# test');

      const deleted = await grubService.deleteConfigGrubConfig('testgroup');

      expect(deleted).toBe(true);

      const fileExists = await fs.access(filepath).then(() => true).catch(() => false);
      expect(fileExists).toBe(false);
    });

    test('should return false if file does not exist', async () => {
      const deleted = await grubService.deleteConfigGrubConfig('nonexistent');

      expect(deleted).toBe(false);
    });
  });

  describe('deleteHostGrubConfig', () => {
    test('should delete host config file', async () => {
      const filepath = path.join(hostcfgDir, 'testhost.cfg');
      await fs.writeFile(filepath, '# test');

      const deleted = await grubService.deleteHostGrubConfig('testhost');

      expect(deleted).toBe(true);

      const fileExists = await fs.access(filepath).then(() => true).catch(() => false);
      expect(fileExists).toBe(false);
    });

    test('should delete symlink', async () => {
      const filepath = path.join(hostcfgDir, 'delete-symlink.cfg');
      try { await fs.unlink(filepath); } catch {}
      await fs.symlink('../testgroup.cfg', filepath);

      const deleted = await grubService.deleteHostGrubConfig('delete-symlink');

      expect(deleted).toBe(true);

      const fileExists = await fs.access(filepath).then(() => true).catch(() => false);
      expect(fileExists).toBe(false);
    });
  });

  describe('listGrubConfigs', () => {
    test('should list all GRUB configs', async () => {
      await fs.writeFile(path.join(grubDir, 'list-group1.cfg'), '# test');
      await fs.writeFile(path.join(grubDir, 'list-group2.cfg'), '# test');
      await fs.writeFile(path.join(hostcfgDir, 'list-host1.cfg'), '# test');

      const result = await grubService.listGrubConfigs();

      expect(result.configs).toContain('list-group1');
      expect(result.configs).toContain('list-group2');
      expect(result.hosts.some(h => h.name === 'list-host1')).toBe(true);
    });

    test('should identify symlinks in host list', async () => {
      const filepath = path.join(hostcfgDir, 'symlink-list.cfg');
      try { await fs.unlink(filepath); } catch {}
      await fs.symlink('../testgroup.cfg', filepath);

      const result = await grubService.listGrubConfigs();

      const host = result.hosts.find(h => h.name === 'symlink-list');
      expect(host).toBeDefined();
      expect(host.isSymlink).toBe(true);
      expect(host.target).toBe('../testgroup.cfg');
    });

    test('should identify regular files in host list', async () => {
      await fs.writeFile(path.join(hostcfgDir, 'regular-file.cfg'), '# content');

      const result = await grubService.listGrubConfigs();

      const host = result.hosts.find(h => h.name === 'regular-file');
      expect(host).toBeDefined();
      expect(host.isSymlink).toBe(false);
    });

    test('should exclude grub.cfg from configs list', async () => {
      await fs.writeFile(path.join(grubDir, 'grub.cfg'), '# main');

      const result = await grubService.listGrubConfigs();

      expect(result.configs).not.toContain('grub');
    });
  });

  describe('cleanupOrphanedConfigs', () => {
    test('should remove configs for non-existent configs', async () => {
      await fs.writeFile(path.join(grubDir, 'orphanconfig.cfg'), '# test');

      prisma.config.findMany.mockResolvedValue([{ name: 'existingconfig' }]);
      prisma.host.findMany.mockResolvedValue([]);

      const result = await grubService.cleanupOrphanedConfigs();

      expect(result.removedConfigs).toContain('orphanconfig');
    });

    test('should remove configs for non-existent hosts', async () => {
      await fs.writeFile(path.join(hostcfgDir, 'orphanhost.cfg'), '# test');

      prisma.config.findMany.mockResolvedValue([]);
      prisma.host.findMany.mockResolvedValue([{ hostname: 'existinghost' }]);

      const result = await grubService.cleanupOrphanedConfigs();

      expect(result.removedHosts).toContain('orphanhost');
    });

    test('should not remove configs for existing entities', async () => {
      await fs.writeFile(path.join(grubDir, 'validconfig.cfg'), '# test');

      prisma.config.findMany.mockResolvedValue([{ name: 'validconfig' }]);
      prisma.host.findMany.mockResolvedValue([]);

      const result = await grubService.cleanupOrphanedConfigs();

      expect(result.removedConfigs).not.toContain('validconfig');

      const fileExists = await fs.access(path.join(grubDir, 'validconfig.cfg'))
        .then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });
  });
});
