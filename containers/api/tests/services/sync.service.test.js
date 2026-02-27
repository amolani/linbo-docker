/**
 * Tests for Sync Service
 */
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

// Setup temp dir and env before module load
const tmpDir = `${os.tmpdir()}/linbo-sync-test-${process.pid}`;
process.env.LINBO_DIR = tmpDir;
process.env.LINBO_SERVER_IP = '10.0.0.13';

// Mock dependencies
jest.mock('../../src/lib/redis', () => {
  const store = new Map();
  const sets = new Map();
  const mockClient = {
    get: jest.fn(async (key) => store.get(key) || null),
    set: jest.fn(async (key, val) => { store.set(key, val); }),
    del: jest.fn(async (key) => { store.delete(key); }),
    mget: jest.fn(async (...keys) => {
      const flat = keys.flat();
      return flat.map(k => store.get(k) || null);
    }),
    sadd: jest.fn(async (key, ...members) => {
      if (!sets.has(key)) sets.set(key, new Set());
      for (const m of members.flat()) sets.get(key).add(m);
    }),
    srem: jest.fn(async (key, ...members) => {
      const s = sets.get(key);
      if (s) for (const m of members.flat()) s.delete(m);
    }),
    smembers: jest.fn(async (key) => [...(sets.get(key) || [])]),
    scard: jest.fn(async (key) => (sets.get(key) || new Set()).size),
    pipeline: jest.fn(() => {
      const ops = [];
      const p = {
        get: (key) => { ops.push(['get', key]); return p; },
        exec: async () => ops.map(([, key]) => [null, store.get(key) || null]),
      };
      return p;
    }),
    _store: store,
    _sets: sets,
    _reset: () => { store.clear(); sets.clear(); },
  };
  return {
    getClient: () => mockClient,
    disconnect: jest.fn(),
  };
});

jest.mock('../../src/lib/lmn-api-client', () => ({
  getChanges: jest.fn(),
  batchGetHosts: jest.fn(),
  batchGetStartConfs: jest.fn(),
  batchGetConfigs: jest.fn(),
  getDhcpExport: jest.fn(),
  checkHealth: jest.fn(),
}));

jest.mock('../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
  getServer: jest.fn(),
}));

jest.mock('../../src/services/grub-generator', () => ({
  regenerateAll: jest.fn(async () => ({ configs: 1, hosts: 2, hostcfgMac: 2 })),
}));

const redis = require('../../src/lib/redis');
const lmnClient = require('../../src/lib/lmn-api-client');
const grubGenerator = require('../../src/services/grub-generator');
const { syncOnce, getSyncStatus, resetSync, KEY } = require('../../src/services/sync.service');

beforeAll(async () => {
  await fsp.mkdir(tmpDir, { recursive: true });
});

afterAll(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  jest.clearAllMocks();
  redis.getClient()._reset();
  // Clean up tmpDir files
  try {
    const files = await fsp.readdir(tmpDir);
    for (const f of files) await fsp.rm(path.join(tmpDir, f), { recursive: true, force: true });
  } catch {}
});

// =============================================================================
// Tests
// =============================================================================

describe('syncOnce — full sync (empty cursor)', () => {
  const DELTA = {
    nextCursor: '1708943200:42',
    hostsChanged: ['AA:BB:CC:DD:EE:01'],
    startConfsChanged: ['win11_efi_sata'],
    configsChanged: ['win11_efi_sata'],
    dhcpChanged: true,
    deletedHosts: [],
    deletedStartConfs: [],
  };

  const HOST = {
    mac: 'AA:BB:CC:DD:EE:01',
    hostname: 'r100-pc01',
    ip: '10.0.100.1',
    hostgroup: 'win11_efi_sata',
    pxeEnabled: true,
    pxeFlag: 1,
    startConfId: 'win11_efi_sata',
  };

  const START_CONF_CONTENT = `[LINBO]
Server = 10.0.0.1
Group = win11_efi_sata
KernelOptions = quiet splash server=10.0.0.1

[OS]
Name = Windows 11`;

  const CONFIG = {
    id: 'win11_efi_sata',
    name: 'Windows 11 EFI SATA',
    osEntries: [{ name: 'Windows 11', root: '/dev/sda3' }],
    partitions: [{ device: '/dev/sda3', label: 'windows' }],
    grubPolicy: { timeout: 5 },
  };

  beforeEach(() => {
    lmnClient.getChanges.mockResolvedValue(DELTA);
    lmnClient.batchGetHosts.mockResolvedValue({ hosts: [HOST] });
    lmnClient.batchGetStartConfs.mockResolvedValue({
      startConfs: [{ id: 'win11_efi_sata', content: START_CONF_CONTENT, hash: 'abc' }],
    });
    lmnClient.batchGetConfigs.mockResolvedValue({ configs: [CONFIG] });
    lmnClient.getDhcpExport.mockResolvedValue({ status: 200, content: '# dnsmasq config', etag: '"v1"' });
  });

  it('should call getChanges with empty cursor', async () => {
    await syncOnce();
    expect(lmnClient.getChanges).toHaveBeenCalledWith('');
  });

  it('should write start.conf with server= rewrite', async () => {
    await syncOnce();
    const content = await fsp.readFile(path.join(tmpDir, 'start.conf.win11_efi_sata'), 'utf8');
    expect(content).toContain('Server = 10.0.0.13');
    expect(content).toContain('server=10.0.0.13');
    expect(content).not.toMatch(/Server = 10\.0\.0\.1\n/);
  });

  it('should write MD5 file alongside start.conf', async () => {
    await syncOnce();
    const md5 = await fsp.readFile(path.join(tmpDir, 'start.conf.win11_efi_sata.md5'), 'utf8');
    expect(md5).toMatch(/^[0-9a-f]{32}$/);
  });

  it('should create IP-based symlink', async () => {
    await syncOnce();
    const target = await fsp.readlink(path.join(tmpDir, 'start.conf-10.0.100.1'));
    expect(target).toBe('start.conf.win11_efi_sata');
  });

  it('should create MAC-based symlink (lowercase)', async () => {
    await syncOnce();
    const target = await fsp.readlink(path.join(tmpDir, 'start.conf-aa:bb:cc:dd:ee:01'));
    expect(target).toBe('start.conf.win11_efi_sata');
  });

  it('should cache host in Redis', async () => {
    await syncOnce();
    const client = redis.getClient();
    const hostJson = client._store.get('sync:host:AA:BB:CC:DD:EE:01');
    expect(JSON.parse(hostJson).hostname).toBe('r100-pc01');
  });

  it('should cache config in Redis', async () => {
    await syncOnce();
    const client = redis.getClient();
    const configJson = client._store.get('sync:config:win11_efi_sata');
    expect(JSON.parse(configJson).name).toBe('Windows 11 EFI SATA');
  });

  it('should save cursor after success', async () => {
    await syncOnce();
    const client = redis.getClient();
    expect(client._store.get('sync:cursor')).toBe('1708943200:42');
  });

  it('should regenerate GRUB configs', async () => {
    await syncOnce();
    expect(grubGenerator.regenerateAll).toHaveBeenCalledTimes(1);
  });

  it('should write DHCP export', async () => {
    await syncOnce();
    const content = await fsp.readFile(path.join(tmpDir, 'dhcp/dnsmasq-proxy.conf'), 'utf8');
    expect(content).toBe('# dnsmasq config');
  });

  it('should save DHCP ETag', async () => {
    await syncOnce();
    const client = redis.getClient();
    expect(client._store.get('sync:dhcp:etag')).toBe('"v1"');
  });
});

describe('syncOnce — incremental sync', () => {
  it('should pass existing cursor to getChanges', async () => {
    const client = redis.getClient();
    client._store.set('sync:cursor', '1708943200:42');

    lmnClient.getChanges.mockResolvedValue({
      nextCursor: '1708943260:43',
      hostsChanged: [],
      startConfsChanged: [],
      configsChanged: [],
      dhcpChanged: false,
      deletedHosts: [],
      deletedStartConfs: [],
    });

    await syncOnce();
    expect(lmnClient.getChanges).toHaveBeenCalledWith('1708943200:42');
    expect(client._store.get('sync:cursor')).toBe('1708943260:43');
  });

  it('should not regenerate GRUB on no changes', async () => {
    const client = redis.getClient();
    client._store.set('sync:cursor', '1708943200:42');

    lmnClient.getChanges.mockResolvedValue({
      nextCursor: '1708943260:43',
      hostsChanged: [],
      startConfsChanged: [],
      configsChanged: [],
      dhcpChanged: false,
      deletedHosts: [],
      deletedStartConfs: [],
    });

    await syncOnce();
    expect(grubGenerator.regenerateAll).not.toHaveBeenCalled();
  });
});

describe('syncOnce — deletions', () => {
  it('should remove start.conf for deleted configs', async () => {
    // Pre-create a start.conf
    await fsp.writeFile(path.join(tmpDir, 'start.conf.old_config'), 'old content');
    await fsp.writeFile(path.join(tmpDir, 'start.conf.old_config.md5'), 'abc');

    const client = redis.getClient();
    client._store.set('sync:cursor', '100:1');

    lmnClient.getChanges.mockResolvedValue({
      nextCursor: '100:2',
      hostsChanged: [],
      startConfsChanged: [],
      configsChanged: [],
      dhcpChanged: false,
      deletedHosts: [],
      deletedStartConfs: ['old_config'],
    });

    await syncOnce();

    await expect(fsp.stat(path.join(tmpDir, 'start.conf.old_config'))).rejects.toThrow();
    await expect(fsp.stat(path.join(tmpDir, 'start.conf.old_config.md5'))).rejects.toThrow();
  });

  it('should remove symlinks for deleted hosts', async () => {
    const client = redis.getClient();
    client._store.set('sync:cursor', '100:1');
    // Pre-cache host
    client._store.set('sync:host:AA:BB:CC:DD:EE:99', JSON.stringify({
      mac: 'AA:BB:CC:DD:EE:99', hostname: 'deleted-pc', ip: '10.0.0.99', hostgroup: 'test',
    }));
    client._sets.set('sync:host:index', new Set(['AA:BB:CC:DD:EE:99']));

    // Pre-create symlinks
    await fsp.symlink('start.conf.test', path.join(tmpDir, 'start.conf-10.0.0.99'));
    await fsp.symlink('start.conf.test', path.join(tmpDir, 'start.conf-aa:bb:cc:dd:ee:99'));

    lmnClient.getChanges.mockResolvedValue({
      nextCursor: '100:2',
      hostsChanged: [],
      startConfsChanged: [],
      configsChanged: [],
      dhcpChanged: false,
      deletedHosts: ['AA:BB:CC:DD:EE:99'],
      deletedStartConfs: [],
    });

    await syncOnce();

    await expect(fsp.lstat(path.join(tmpDir, 'start.conf-10.0.0.99'))).rejects.toThrow();
    await expect(fsp.lstat(path.join(tmpDir, 'start.conf-aa:bb:cc:dd:ee:99'))).rejects.toThrow();
    expect(client._store.has('sync:host:AA:BB:CC:DD:EE:99')).toBe(false);
  });
});

describe('syncOnce — error handling', () => {
  it('should not update cursor on failure', async () => {
    const client = redis.getClient();
    client._store.set('sync:cursor', '100:1');

    lmnClient.getChanges.mockRejectedValue(new Error('API down'));

    await expect(syncOnce()).rejects.toThrow('API down');

    // Cursor should NOT have changed
    expect(client._store.get('sync:cursor')).toBe('100:1');
    // Error should be recorded
    expect(client._store.get('sync:lastError')).toBe('API down');
    // Running flag should be cleared
    expect(client._store.get('sync:isRunning')).toBe('false');
  });

  it('should prevent concurrent syncs', async () => {
    const client = redis.getClient();
    client._store.set('sync:isRunning', 'true');

    await expect(syncOnce()).rejects.toThrow('Sync already in progress');
  });
});

describe('getSyncStatus', () => {
  it('should return current status', async () => {
    const client = redis.getClient();
    client._store.set('sync:cursor', '100:1');
    client._store.set('sync:lastSyncAt', '2026-02-27T08:00:00Z');
    client._store.set('sync:isRunning', 'false');
    client._sets.set('sync:host:index', new Set(['mac1', 'mac2']));
    client._sets.set('sync:config:index', new Set(['cfg1']));

    lmnClient.checkHealth.mockResolvedValue({ healthy: true });

    const status = await getSyncStatus();
    expect(status.cursor).toBe('100:1');
    expect(status.lastSyncAt).toBe('2026-02-27T08:00:00Z');
    expect(status.isRunning).toBe(false);
    expect(status.hostCount).toBe(2);
    expect(status.configCount).toBe(1);
    expect(status.lmnApiHealthy).toBe(true);
  });
});

describe('resetSync', () => {
  it('should clear cursor', async () => {
    const client = redis.getClient();
    client._store.set('sync:cursor', '100:1');

    await resetSync();
    expect(client._store.has('sync:cursor')).toBe(false);
  });
});
