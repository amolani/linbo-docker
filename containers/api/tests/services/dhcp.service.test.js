/**
 * LINBO Docker - DHCP Service Tests
 * Tests for ISC DHCP/dnsmasq config generation, network settings, and summary
 */

// Mock dependencies
jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    host: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    config: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('../../src/lib/redis', () => ({
  get: jest.fn(),
  set: jest.fn(),
}));

const { prisma } = require('../../src/lib/prisma');
const redis = require('../../src/lib/redis');
const dhcpService = require('../../src/services/dhcp.service');

// =============================================================================
// Test Fixtures
// =============================================================================

const mockConfigA = {
  id: 'cfg-aaa',
  name: 'pc-raum-101',
  status: 'active',
  updatedAt: new Date('2026-02-05T10:00:00Z'),
};

const mockConfigB = {
  id: 'cfg-bbb',
  name: 'pc-raum-202',
  status: 'active',
  updatedAt: new Date('2026-02-05T09:00:00Z'),
};

const mockRoom = {
  id: 'room-001',
  name: 'Raum 101',
};

const mockHost1 = {
  id: 'host-001',
  hostname: 'pc-r101-01',
  macAddress: 'AA:BB:CC:DD:EE:01',
  ipAddress: '10.0.1.1',
  configId: 'cfg-aaa',
  roomId: 'room-001',
  config: mockConfigA,
  room: mockRoom,
  metadata: { pxeFlag: 1 },
  updatedAt: new Date('2026-02-05T10:00:00Z'),
};

const mockHost2 = {
  id: 'host-002',
  hostname: 'pc-r101-02',
  macAddress: 'AA:BB:CC:DD:EE:02',
  ipAddress: '10.0.1.2',
  configId: 'cfg-aaa',
  roomId: 'room-001',
  config: mockConfigA,
  room: mockRoom,
  metadata: { pxeFlag: 1 },
  updatedAt: new Date('2026-02-05T10:00:00Z'),
};

const mockHost3 = {
  id: 'host-003',
  hostname: 'pc-r202-01',
  macAddress: 'AA:BB:CC:DD:EE:03',
  ipAddress: '10.0.2.1',
  configId: 'cfg-bbb',
  roomId: null,
  config: mockConfigB,
  room: null,
  metadata: { pxeFlag: 1 },
  updatedAt: new Date('2026-02-05T09:00:00Z'),
};

const mockHostNoPxe = {
  id: 'host-004',
  hostname: 'printer-01',
  macAddress: 'AA:BB:CC:DD:EE:04',
  ipAddress: '10.0.1.100',
  configId: null,
  roomId: 'room-001',
  config: null,
  room: mockRoom,
  metadata: { pxeFlag: 0 },
  updatedAt: new Date('2026-02-05T08:00:00Z'),
};

const mockHostDhcp = {
  id: 'host-005',
  hostname: 'laptop-01',
  macAddress: 'AA:BB:CC:DD:EE:05',
  ipAddress: null,
  configId: 'cfg-aaa',
  roomId: null,
  config: mockConfigA,
  room: null,
  metadata: {},
  updatedAt: new Date('2026-02-05T08:00:00Z'),
};

const allHosts = [mockHost1, mockHost2, mockHost3, mockHostNoPxe, mockHostDhcp];

// =============================================================================
// Test Environment
// =============================================================================

const originalEnv = process.env;

beforeAll(() => {
  process.env = {
    ...originalEnv,
    LINBO_SERVER_IP: '10.0.0.1',
    LINBO_SUBNET: '10.0.0.0',
    LINBO_NETMASK: '255.255.0.0',
    LINBO_GATEWAY: '10.0.0.254',
    LINBO_DNS: '10.0.0.1',
    LINBO_DOMAIN: 'linuxmuster.lan',
  };
});

afterAll(() => {
  process.env = originalEnv;
});

beforeEach(() => {
  jest.clearAllMocks();
  redis.get.mockResolvedValue(null);
  redis.set.mockResolvedValue(undefined);
  prisma.host.findMany.mockResolvedValue(allHosts);
});

// =============================================================================
// Network Settings Tests
// =============================================================================

describe('Network Settings', () => {
  test('should return defaults from ENV when no Redis data', async () => {
    redis.get.mockResolvedValue(null);

    const settings = await dhcpService.getNetworkSettings();

    expect(settings.serverIp).toBe('10.0.0.1');
    expect(settings.subnet).toBe('10.0.0.0');
    expect(settings.netmask).toBe('255.255.0.0');
    expect(settings.gateway).toBe('10.0.0.254');
    expect(settings.dns).toBe('10.0.0.1');
    expect(settings.domain).toBe('linuxmuster.lan');
    expect(settings.lastExportedAt).toBeNull();
  });

  test('should merge stored settings with defaults', async () => {
    redis.get.mockResolvedValue({
      gateway: '10.0.0.1',
      domain: 'school.lan',
      lastExportedAt: '2026-02-05T12:00:00Z',
    });

    const settings = await dhcpService.getNetworkSettings();

    expect(settings.gateway).toBe('10.0.0.1');
    expect(settings.domain).toBe('school.lan');
    expect(settings.subnet).toBe('10.0.0.0'); // from ENV default
    expect(settings.lastExportedAt).toBe('2026-02-05T12:00:00Z');
  });

  test('should save settings to Redis', async () => {
    redis.get.mockResolvedValue(null);

    await dhcpService.saveNetworkSettings({
      gateway: '10.0.0.1',
      dhcpRangeStart: '10.0.100.1',
      dhcpRangeEnd: '10.0.100.254',
    });

    expect(redis.set).toHaveBeenCalledWith(
      'system:network-settings',
      expect.objectContaining({
        gateway: '10.0.0.1',
        dhcpRangeStart: '10.0.100.1',
        dhcpRangeEnd: '10.0.100.254',
        updatedAt: expect.any(String),
      })
    );
  });

  test('should update lastExportedAt on markExported', async () => {
    redis.get.mockResolvedValue(null);

    await dhcpService.markExported();

    expect(redis.set).toHaveBeenCalledWith(
      'system:network-settings',
      expect.objectContaining({
        lastExportedAt: expect.any(String),
      })
    );
  });

  test('getDefaults should return all expected keys', () => {
    const defaults = dhcpService.getDefaults();

    expect(defaults).toHaveProperty('dhcpServerIp');
    expect(defaults).toHaveProperty('serverIp');
    expect(defaults).toHaveProperty('subnet');
    expect(defaults).toHaveProperty('netmask');
    expect(defaults).toHaveProperty('gateway');
    expect(defaults).toHaveProperty('dns');
    expect(defaults).toHaveProperty('domain');
    expect(defaults).toHaveProperty('defaultLeaseTime');
    expect(defaults).toHaveProperty('maxLeaseTime');
  });

  test('should preserve existing settings on partial update', async () => {
    redis.get.mockResolvedValue({
      gateway: '10.0.0.1',
      domain: 'school.lan',
      lastExportedAt: '2026-02-05T12:00:00Z',
    });

    await dhcpService.saveNetworkSettings({ dns: '8.8.8.8' });

    expect(redis.set).toHaveBeenCalledWith(
      'system:network-settings',
      expect.objectContaining({
        gateway: '10.0.0.1',
        domain: 'school.lan',
        dns: '8.8.8.8',
      })
    );
  });

  test('should handle empty DHCP range fields', async () => {
    const settings = await dhcpService.getNetworkSettings();
    expect(settings.dhcpRangeStart).toBe('');
    expect(settings.dhcpRangeEnd).toBe('');
  });

  test('should have default lease times', async () => {
    const settings = await dhcpService.getNetworkSettings();
    expect(settings.defaultLeaseTime).toBe(86400);
    expect(settings.maxLeaseTime).toBe(172800);
  });
});

// =============================================================================
// ISC DHCP Generation Tests
// =============================================================================

describe('ISC DHCP Generation', () => {
  test('should generate valid ISC DHCP config with header', async () => {
    const config = await dhcpService.generateIscDhcpConfig();

    expect(config).toContain('# LINBO Docker - ISC DHCP Configuration');
    expect(config).toContain('option arch code 93 = unsigned integer 16;');
    expect(config).toContain('server-identifier 10.0.0.1;');
    expect(config).toContain('server-name "10.0.0.1";');
    expect(config).toContain('next-server 10.0.0.1;');
    expect(config).toContain('filename "boot/grub/x86_64-efi/core.efi"');
    expect(config).toContain('filename "boot/grub/i386-pc/core.0"');
  });

  test('should include subnet block', async () => {
    const config = await dhcpService.generateIscDhcpConfig();

    expect(config).toContain('subnet 10.0.0.0 netmask 255.255.0.0 {');
    expect(config).toContain('option routers 10.0.0.254;');
    expect(config).toContain('option domain-name-servers 10.0.0.1;');
    expect(config).toContain('option domain-name "linuxmuster.lan";');
  });

  test('should include host entries with fixed-address', async () => {
    const config = await dhcpService.generateIscDhcpConfig();

    expect(config).toContain('host pc-r101-01 {');
    expect(config).toContain('hardware ethernet AA:BB:CC:DD:EE:01;');
    expect(config).toContain('fixed-address 10.0.1.1;');
    expect(config).toContain('option host-name "pc-r101-01";');
  });

  test('should include nis-domain and extensions-path for PXE hosts', async () => {
    const config = await dhcpService.generateIscDhcpConfig();

    expect(config).toContain('option nis-domain "pc-raum-101";');
    expect(config).toContain('option extensions-path "pc-raum-101";');
  });

  test('should NOT include PXE options for non-PXE hosts', async () => {
    prisma.host.findMany.mockResolvedValue([mockHostNoPxe]);

    const config = await dhcpService.generateIscDhcpConfig();

    expect(config).toContain('host printer-01 {');
    expect(config).not.toContain('option nis-domain "null"');
    expect(config).not.toContain('option extensions-path "null"');
  });

  test('should handle hosts without static IP', async () => {
    prisma.host.findMany.mockResolvedValue([mockHostDhcp]);

    const config = await dhcpService.generateIscDhcpConfig();

    expect(config).toContain('host laptop-01 {');
    expect(config).not.toContain('fixed-address');
    // Should still have PXE options since it has a config
    expect(config).toContain('option nis-domain "pc-raum-101";');
  });

  test('should group hosts by config with comments', async () => {
    const config = await dhcpService.generateIscDhcpConfig();

    expect(config).toContain('# Config: pc-raum-101');
    expect(config).toContain('# Config: pc-raum-202');
  });

  test('should omit header when includeHeader=false', async () => {
    const config = await dhcpService.generateIscDhcpConfig({ includeHeader: false });

    expect(config).not.toContain('# LINBO Docker - ISC DHCP Configuration');
    expect(config).not.toContain('option arch code');
    expect(config).not.toContain('next-server');
  });

  test('should omit subnet when includeSubnet=false', async () => {
    const config = await dhcpService.generateIscDhcpConfig({ includeSubnet: false });

    expect(config).not.toContain('subnet 10.0.0.0 netmask');
    // Should still contain host entries
    expect(config).toContain('host pc-r101-01 {');
  });

  test('should include DHCP range when configured', async () => {
    redis.get.mockResolvedValue({
      dhcpRangeStart: '10.0.100.1',
      dhcpRangeEnd: '10.0.100.254',
    });

    const config = await dhcpService.generateIscDhcpConfig();

    expect(config).toContain('range 10.0.100.1 10.0.100.254;');
  });

  test('should filter by pxeOnly option', async () => {
    const config = await dhcpService.generateIscDhcpConfig({ pxeOnly: true });

    // pxeOnly calls getHostsForDhcp which filters - mockHost1..3 and mockHostDhcp have config
    // mockHostNoPxe has no config so pxeFlag=0
    expect(prisma.host.findMany).toHaveBeenCalled();
  });

  test('should include arch detection for i386-efi', async () => {
    const config = await dhcpService.generateIscDhcpConfig();

    expect(config).toContain('if option arch = 00:06');
    expect(config).toContain('filename "boot/grub/i386-efi/core.efi"');
  });
});

// =============================================================================
// dnsmasq Generation Tests
// =============================================================================

describe('dnsmasq Full Mode Generation', () => {
  test('should generate valid dnsmasq full config', async () => {
    const config = await dhcpService.generateDnsmasqConfig({ mode: 'full' });

    expect(config).toContain('# LINBO Docker - dnsmasq Configuration (full mode)');
    expect(config).toContain('domain=linuxmuster.lan');
    expect(config).toContain('interface=eth0');
    expect(config).toContain('bind-interfaces');
  });

  test('should include gateway and DNS options', async () => {
    const config = await dhcpService.generateDnsmasqConfig({ mode: 'full' });

    expect(config).toContain('dhcp-option=3,10.0.0.254');
    expect(config).toContain('dhcp-option=6,10.0.0.1');
    expect(config).toContain('dhcp-option=15,linuxmuster.lan');
  });

  test('should include architecture detection', async () => {
    const config = await dhcpService.generateDnsmasqConfig({ mode: 'full' });

    expect(config).toContain('dhcp-match=set:bios,option:client-arch,0');
    expect(config).toContain('dhcp-match=set:efi64,option:client-arch,7');
    expect(config).toContain('dhcp-boot=tag:bios,boot/grub/i386-pc/core.0,10.0.0.1');
    expect(config).toContain('dhcp-boot=tag:efi64,boot/grub/x86_64-efi/core.efi,10.0.0.1');
  });

  test('should include host entries with config tags', async () => {
    const config = await dhcpService.generateDnsmasqConfig({ mode: 'full' });

    expect(config).toContain('dhcp-host=AA:BB:CC:DD:EE:01,10.0.1.1,pc-r101-01,set:pc-raum-101');
    expect(config).toContain('dhcp-host=AA:BB:CC:DD:EE:03,10.0.2.1,pc-r202-01,set:pc-raum-202');
  });

  test('should include NIS-Domain option per config', async () => {
    const config = await dhcpService.generateDnsmasqConfig({ mode: 'full' });

    expect(config).toContain('dhcp-option=tag:pc-raum-101,40,pc-raum-101');
    expect(config).toContain('dhcp-option=tag:pc-raum-202,40,pc-raum-202');
  });

  test('should include non-PXE hosts without config tags', async () => {
    const config = await dhcpService.generateDnsmasqConfig({ mode: 'full' });

    expect(config).toContain('# Non-PXE hosts');
    expect(config).toContain('dhcp-host=AA:BB:CC:DD:EE:04,10.0.1.100,printer-01');
  });

  test('should include DHCP range when configured', async () => {
    redis.get.mockResolvedValue({
      dhcpRangeStart: '10.0.100.1',
      dhcpRangeEnd: '10.0.100.254',
    });

    const config = await dhcpService.generateDnsmasqConfig({ mode: 'full' });

    expect(config).toContain('dhcp-range=10.0.100.1,10.0.100.254,255.255.0.0,86400s');
  });

  test('should comment out range when not configured', async () => {
    const config = await dhcpService.generateDnsmasqConfig({ mode: 'full' });

    expect(config).toContain('# dhcp-range=<start>,<end>,');
  });
});

describe('dnsmasq Proxy Mode Generation', () => {
  test('should generate valid proxy config', async () => {
    const config = await dhcpService.generateDnsmasqConfig({ mode: 'proxy' });

    expect(config).toContain('# LINBO Docker - dnsmasq Configuration (proxy mode)');
    expect(config).toContain('port=0');
    expect(config).toContain('dhcp-range=10.0.0.0,proxy');
  });

  test('should not include gateway or DNS options in proxy mode', async () => {
    const config = await dhcpService.generateDnsmasqConfig({ mode: 'proxy' });

    expect(config).not.toContain('dhcp-option=3,');
    expect(config).not.toContain('dhcp-option=6,');
  });

  test('should include PXE boot files with server IP', async () => {
    const config = await dhcpService.generateDnsmasqConfig({ mode: 'proxy' });

    expect(config).toContain('dhcp-boot=tag:bios,boot/grub/i386-pc/core.0,10.0.0.1');
    expect(config).toContain('dhcp-boot=tag:efi64,boot/grub/x86_64-efi/core.efi,10.0.0.1');
  });

  test('should include host-config assignments for PXE hosts only', async () => {
    const config = await dhcpService.generateDnsmasqConfig({ mode: 'proxy' });

    expect(config).toContain('dhcp-host=AA:BB:CC:DD:EE:01,set:pc-raum-101');
    expect(config).toContain('dhcp-host=AA:BB:CC:DD:EE:03,set:pc-raum-202');
    // Non-PXE host should NOT be included
    expect(config).not.toContain('AA:BB:CC:DD:EE:04');
  });

  test('should include NIS-Domain option per config in proxy mode', async () => {
    const config = await dhcpService.generateDnsmasqConfig({ mode: 'proxy' });

    expect(config).toContain('dhcp-option=tag:pc-raum-101,40,pc-raum-101');
    expect(config).toContain('dhcp-option=tag:pc-raum-202,40,pc-raum-202');
  });

  test('should enable TFTP in proxy mode', async () => {
    const config = await dhcpService.generateDnsmasqConfig({ mode: 'proxy' });

    expect(config).toContain('tftp-root=/srv/linbo');
    expect(config).toContain('enable-tftp');
  });
});

// =============================================================================
// Summary Tests
// =============================================================================

describe('DHCP Summary', () => {
  test('should return correct host counts', async () => {
    prisma.host.findMany.mockResolvedValue(allHosts);
    prisma.host.findFirst.mockResolvedValue({ updatedAt: new Date('2026-02-05T10:00:00Z') });
    prisma.config.findFirst.mockResolvedValue({ updatedAt: new Date('2026-02-05T09:00:00Z') });

    const summary = await dhcpService.getDhcpSummary();

    expect(summary.totalHosts).toBe(5);
    expect(summary.pxeHosts).toBe(4); // host1, host2, host3, hostDhcp
    expect(summary.staticIpHosts).toBe(4); // all except hostDhcp
    expect(summary.dhcpIpHosts).toBe(1); // hostDhcp
  });

  test('should return config breakdown', async () => {
    prisma.host.findMany.mockResolvedValue(allHosts);
    prisma.host.findFirst.mockResolvedValue({ updatedAt: new Date('2026-02-05T10:00:00Z') });
    prisma.config.findFirst.mockResolvedValue({ updatedAt: new Date('2026-02-05T09:00:00Z') });

    const summary = await dhcpService.getDhcpSummary();

    expect(summary.configCounts['pc-raum-101']).toBe(3); // host1, host2, hostDhcp
    expect(summary.configCounts['pc-raum-202']).toBe(1); // host3
    expect(summary.configCounts['no-config']).toBe(1); // hostNoPxe
  });

  test('should detect stale when hosts changed after export', async () => {
    redis.get.mockResolvedValue({
      lastExportedAt: '2026-02-05T08:00:00Z',
    });
    prisma.host.findMany.mockResolvedValue(allHosts);
    prisma.host.findFirst.mockResolvedValue({ updatedAt: new Date('2026-02-05T10:00:00Z') });
    prisma.config.findFirst.mockResolvedValue({ updatedAt: new Date('2026-02-05T09:00:00Z') });

    const summary = await dhcpService.getDhcpSummary();

    expect(summary.isStale).toBe(true);
  });

  test('should not be stale when export is recent', async () => {
    redis.get.mockResolvedValue({
      lastExportedAt: '2026-02-05T12:00:00Z',
    });
    prisma.host.findMany.mockResolvedValue(allHosts);
    prisma.host.findFirst.mockResolvedValue({ updatedAt: new Date('2026-02-05T10:00:00Z') });
    prisma.config.findFirst.mockResolvedValue({ updatedAt: new Date('2026-02-05T09:00:00Z') });

    const summary = await dhcpService.getDhcpSummary();

    expect(summary.isStale).toBe(false);
  });

  test('should be stale when never exported', async () => {
    redis.get.mockResolvedValue(null);
    prisma.host.findMany.mockResolvedValue(allHosts);
    prisma.host.findFirst.mockResolvedValue({ updatedAt: new Date('2026-02-05T10:00:00Z') });
    prisma.config.findFirst.mockResolvedValue({ updatedAt: new Date('2026-02-05T09:00:00Z') });

    const summary = await dhcpService.getDhcpSummary();

    expect(summary.isStale).toBe(true);
  });
});

// =============================================================================
// Helper Tests
// =============================================================================

describe('Helpers', () => {
  test('groupHostsByConfig should group correctly', () => {
    const groups = dhcpService.groupHostsByConfig([mockHost1, mockHost2, mockHost3]);

    expect(groups.size).toBe(2);
    expect(groups.get('pc-raum-101')).toHaveLength(2);
    expect(groups.get('pc-raum-202')).toHaveLength(1);
  });

  test('groupHostsByConfig should handle hosts without config', () => {
    const groups = dhcpService.groupHostsByConfig([mockHostNoPxe]);

    expect(groups.has('no-config')).toBe(true);
    expect(groups.get('no-config')).toHaveLength(1);
  });

  test('sanitizeTag should replace special chars with underscore', () => {
    expect(dhcpService.sanitizeTag('pc-raum-101')).toBe('pc-raum-101');
    expect(dhcpService.sanitizeTag('my config')).toBe('my_config');
    expect(dhcpService.sanitizeTag('test.conf/v2')).toBe('test_conf_v2');
  });

  test('isPxeEnabled should check configId and pxeFlag', () => {
    expect(dhcpService.isPxeEnabled(mockHost1)).toBe(true);
    expect(dhcpService.isPxeEnabled(mockHostNoPxe)).toBe(false);
  });

  test('getPxeFlag should return metadata.pxeFlag', () => {
    expect(dhcpService.getPxeFlag(mockHost1)).toBe(1);
    expect(dhcpService.getPxeFlag(mockHostNoPxe)).toBe(0);
  });

  test('getPxeFlag should default to 1 for hosts with config', () => {
    const host = { configId: 'cfg-aaa', metadata: {} };
    expect(dhcpService.getPxeFlag(host)).toBe(1);
  });

  test('getPxeFlag should default to 0 for hosts without config', () => {
    const host = { configId: null, metadata: {} };
    expect(dhcpService.getPxeFlag(host)).toBe(0);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('Edge Cases', () => {
  test('should handle empty host list', async () => {
    prisma.host.findMany.mockResolvedValue([]);

    const iscConfig = await dhcpService.generateIscDhcpConfig();
    expect(iscConfig).toContain('subnet');
    expect(iscConfig).not.toContain('host ');

    const dnsmasqConfig = await dhcpService.generateDnsmasqConfig({ mode: 'full' });
    expect(dnsmasqConfig).toContain('domain=');
    expect(dnsmasqConfig).not.toContain('dhcp-host=');

    const proxyConfig = await dhcpService.generateDnsmasqConfig({ mode: 'proxy' });
    expect(proxyConfig).toContain('port=0');
    expect(proxyConfig).not.toContain('dhcp-host=');
  });

  test('should handle hosts with same MAC but different configs', async () => {
    const host1 = { ...mockHost1 };
    const host2 = { ...mockHost3, macAddress: mockHost1.macAddress };
    prisma.host.findMany.mockResolvedValue([host1, host2]);

    const config = await dhcpService.generateIscDhcpConfig();
    // Both should appear (the DHCP server will handle the conflict)
    expect(config).toContain('host pc-r101-01');
    expect(config).toContain('host pc-r202-01');
  });

  test('should generate config with custom interface', async () => {
    const config = await dhcpService.generateDnsmasqConfig({
      mode: 'proxy',
      interface: 'br0',
    });
    expect(config).toContain('interface=br0');
  });
});
