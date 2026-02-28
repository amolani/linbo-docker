/**
 * LINBO Docker - Settings Service Tests
 */

process.env.JWT_SECRET = 'test-secret-settings';

// ---------------------------------------------------------------------------
// Redis Mock
// ---------------------------------------------------------------------------

const redisStore = new Map();

function resetRedis() {
  redisStore.clear();
}

const mockClient = {
  get: jest.fn(async (key) => redisStore.get(key) || null),
  set: jest.fn(async (key, val) => { redisStore.set(key, val); }),
  del: jest.fn(async (...keys) => { keys.flat().forEach(k => redisStore.delete(k)); }),
  status: 'ready',
};

jest.mock('../../src/lib/redis', () => ({
  getClient: () => mockClient,
}));

jest.mock('../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
  getServer: () => null,
  init: jest.fn(),
}));

const ws = require('../../src/lib/websocket');
const settings = require('../../src/services/settings.service');

beforeEach(() => {
  resetRedis();
  settings.invalidateCache();
  jest.clearAllMocks();
  delete process.env.LMN_API_URL;
  delete process.env.LMN_API_KEY;
  delete process.env.LINBO_SERVER_IP;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.SYNC_INTERVAL;
});

// ---------------------------------------------------------------------------
// get()
// ---------------------------------------------------------------------------

describe('get()', () => {
  test('returns default when no Redis or env', async () => {
    const val = await settings.get('lmn_api_url');
    expect(val).toBe('http://10.0.0.11:8000');
  });

  test('returns env when no Redis value', async () => {
    process.env.LMN_API_URL = 'http://custom:9000';
    settings.invalidateCache();
    const val = await settings.get('lmn_api_url');
    expect(val).toBe('http://custom:9000');
  });

  test('returns Redis value over env', async () => {
    process.env.LMN_API_URL = 'http://custom:9000';
    redisStore.set('config:lmn_api_url', 'http://redis:9000');
    settings.invalidateCache();
    const val = await settings.get('lmn_api_url');
    expect(val).toBe('http://redis:9000');
  });

  test('uses in-memory cache on second call', async () => {
    redisStore.set('config:lmn_api_url', 'http://redis:9000');
    settings.invalidateCache();
    await settings.get('lmn_api_url');
    mockClient.get.mockClear();
    const val = await settings.get('lmn_api_url');
    expect(val).toBe('http://redis:9000');
    expect(mockClient.get).not.toHaveBeenCalled();
  });

  test('throws on unknown key', async () => {
    await expect(settings.get('unknown_key')).rejects.toThrow('Unknown setting');
  });
});

// ---------------------------------------------------------------------------
// set()
// ---------------------------------------------------------------------------

describe('set()', () => {
  test('stores value in Redis', async () => {
    await settings.set('lmn_api_url', 'http://new:8000');
    expect(redisStore.get('config:lmn_api_url')).toBe('http://new:8000');
  });

  test('trims value', async () => {
    await settings.set('lmn_api_url', '  http://new:8000  ');
    expect(redisStore.get('config:lmn_api_url')).toBe('http://new:8000');
  });

  test('rejects invalid URL', async () => {
    await expect(settings.set('lmn_api_url', 'ftp://bad')).rejects.toThrow('Invalid value');
  });

  test('rejects invalid URL (no protocol)', async () => {
    await expect(settings.set('lmn_api_url', 'not-a-url')).rejects.toThrow('Invalid value');
  });

  test('rejects invalid IP', async () => {
    await expect(settings.set('linbo_server_ip', '999.0.0.1')).rejects.toThrow('Invalid value');
  });

  test('rejects non-numeric sync_interval', async () => {
    await expect(settings.set('sync_interval', 'abc')).rejects.toThrow('Invalid value');
  });

  test('rejects negative sync_interval', async () => {
    await expect(settings.set('sync_interval', '-1')).rejects.toThrow('Invalid value');
  });

  test('rejects short password', async () => {
    await expect(settings.set('admin_password', 'ab')).rejects.toThrow('Invalid value');
  });

  test('stores admin_password as bcrypt hash', async () => {
    await settings.set('admin_password', 'secure1234');
    const stored = redisStore.get('config:admin_password_hash');
    expect(stored).toBeTruthy();
    expect(stored).not.toBe('secure1234');
    expect(stored).toMatch(/^\$2[ayb]\$/);
  });

  test('invalidates cache after set', async () => {
    redisStore.set('config:lmn_api_url', 'http://old:8000');
    settings.invalidateCache();
    await settings.get('lmn_api_url'); // cache it
    await settings.set('lmn_api_url', 'http://new:8000');
    mockClient.get.mockClear();
    const val = await settings.get('lmn_api_url');
    expect(val).toBe('http://new:8000');
  });

  test('broadcasts settings.changed', async () => {
    await settings.set('linbo_server_ip', '10.0.0.2');
    expect(ws.broadcast).toHaveBeenCalledWith('settings.changed', { key: 'linbo_server_ip' });
  });

  test('rejects setting admin_password_hash directly', async () => {
    await expect(settings.set('admin_password_hash', '$2a$...')).rejects.toThrow('Cannot set admin_password_hash directly');
  });

  test('throws on unknown key', async () => {
    await expect(settings.set('unknown', 'val')).rejects.toThrow('Unknown setting');
  });

  test('accepts valid IP', async () => {
    await settings.set('linbo_server_ip', '192.168.1.1');
    expect(redisStore.get('config:linbo_server_ip')).toBe('192.168.1.1');
  });

  test('accepts zero sync_interval', async () => {
    await settings.set('sync_interval', '0');
    expect(redisStore.get('config:sync_interval')).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe('reset()', () => {
  test('deletes key from Redis', async () => {
    redisStore.set('config:lmn_api_url', 'http://custom:8000');
    await settings.reset('lmn_api_url');
    expect(redisStore.has('config:lmn_api_url')).toBe(false);
  });

  test('reset admin_password deletes admin_password_hash', async () => {
    redisStore.set('config:admin_password_hash', '$2a$...');
    await settings.reset('admin_password');
    expect(redisStore.has('config:admin_password_hash')).toBe(false);
  });

  test('invalidates cache', async () => {
    redisStore.set('config:lmn_api_url', 'http://custom:8000');
    settings.invalidateCache();
    await settings.get('lmn_api_url');
    await settings.reset('lmn_api_url');
    const val = await settings.get('lmn_api_url');
    expect(val).toBe('http://10.0.0.11:8000'); // back to default
  });

  test('broadcasts settings.changed', async () => {
    await settings.reset('lmn_api_url');
    expect(ws.broadcast).toHaveBeenCalledWith('settings.changed', { key: 'lmn_api_url' });
  });
});

// ---------------------------------------------------------------------------
// getAll()
// ---------------------------------------------------------------------------

describe('getAll()', () => {
  test('returns all non-writeOnly settings', async () => {
    const all = await settings.getAll();
    const keys = all.map(s => s.key);
    expect(keys).toContain('lmn_api_url');
    expect(keys).toContain('lmn_api_key');
    expect(keys).toContain('linbo_server_ip');
    expect(keys).toContain('admin_password_hash');
    expect(keys).toContain('sync_interval');
    expect(keys).not.toContain('admin_password'); // writeOnly
  });

  test('masks lmn_api_key value', async () => {
    redisStore.set('config:lmn_api_key', 'my-secret-api-key-1234');
    const all = await settings.getAll();
    const apiKey = all.find(s => s.key === 'lmn_api_key');
    expect(apiKey.valueMasked).toBe('****1234');
    expect(apiKey.value).toBeUndefined();
    expect(apiKey.isSet).toBe(true);
    expect(apiKey.source).toBe('redis');
  });

  test('admin_password_hash only shows isSet', async () => {
    redisStore.set('config:admin_password_hash', '$2a$10$hash');
    const all = await settings.getAll();
    const pw = all.find(s => s.key === 'admin_password_hash');
    expect(pw.isSet).toBe(true);
    expect(pw.value).toBeUndefined();
    expect(pw.valueMasked).toBeUndefined();
  });

  test('non-secret shows full value', async () => {
    redisStore.set('config:lmn_api_url', 'http://test:8000');
    const all = await settings.getAll();
    const url = all.find(s => s.key === 'lmn_api_url');
    expect(url.value).toBe('http://test:8000');
    expect(url.source).toBe('redis');
  });

  test('shows default source when not set', async () => {
    const all = await settings.getAll();
    const url = all.find(s => s.key === 'lmn_api_url');
    expect(url.source).toBe('default');
    expect(url.isSet).toBe(false);
  });

  test('shows env source', async () => {
    process.env.LMN_API_URL = 'http://env:8000';
    const all = await settings.getAll();
    const url = all.find(s => s.key === 'lmn_api_url');
    expect(url.source).toBe('env');
    expect(url.value).toBe('http://env:8000');
    expect(url.isSet).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkAdminPassword()
// ---------------------------------------------------------------------------

describe('checkAdminPassword()', () => {
  test('matches bcrypt hash from Redis', async () => {
    await settings.set('admin_password', 'testPass123');
    const ok = await settings.checkAdminPassword('testPass123');
    expect(ok).toBe(true);
  });

  test('rejects wrong password against hash', async () => {
    await settings.set('admin_password', 'testPass123');
    const ok = await settings.checkAdminPassword('wrongPass');
    expect(ok).toBe(false);
  });

  test('falls back to env var when no hash', async () => {
    process.env.ADMIN_PASSWORD = 'envPass';
    const ok = await settings.checkAdminPassword('envPass');
    expect(ok).toBe(true);
  });

  test('rejects wrong password against env', async () => {
    process.env.ADMIN_PASSWORD = 'envPass';
    const ok = await settings.checkAdminPassword('wrong');
    expect(ok).toBe(false);
  });

  test('returns false when no hash and no env', async () => {
    const ok = await settings.checkAdminPassword('anything');
    expect(ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// snapshot()
// ---------------------------------------------------------------------------

describe('snapshot()', () => {
  test('returns all non-writeOnly/readOnly current values', async () => {
    redisStore.set('config:lmn_api_url', 'http://snap:8000');
    settings.invalidateCache();
    const snap = await settings.snapshot();
    expect(snap.lmn_api_url).toBe('http://snap:8000');
    expect(snap.linbo_server_ip).toBe('10.0.0.1'); // default
    expect(snap.admin_password).toBeUndefined();
    expect(snap.admin_password_hash).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// VALIDATORS
// ---------------------------------------------------------------------------

describe('VALIDATORS', () => {
  const { VALIDATORS } = settings;

  test('lmn_api_url accepts http/https', () => {
    expect(VALIDATORS.lmn_api_url('http://localhost:8000')).toBe(true);
    expect(VALIDATORS.lmn_api_url('https://example.com')).toBe(true);
    expect(VALIDATORS.lmn_api_url('ftp://bad.com')).toBe(false);
    expect(VALIDATORS.lmn_api_url('not-a-url')).toBe(false);
  });

  test('linbo_server_ip accepts valid IPs', () => {
    expect(VALIDATORS.linbo_server_ip('10.0.0.1')).toBe(true);
    expect(VALIDATORS.linbo_server_ip('192.168.1.255')).toBe(true);
    expect(VALIDATORS.linbo_server_ip('999.0.0.1')).toBe(false);
    expect(VALIDATORS.linbo_server_ip('10.0.0')).toBe(false);
    expect(VALIDATORS.linbo_server_ip('abc')).toBe(false);
  });

  test('sync_interval accepts non-negative integers', () => {
    expect(VALIDATORS.sync_interval('0')).toBe(true);
    expect(VALIDATORS.sync_interval('60')).toBe(true);
    expect(VALIDATORS.sync_interval('-1')).toBe(false);
    expect(VALIDATORS.sync_interval('abc')).toBe(false);
  });

  test('admin_password requires min 4 chars', () => {
    expect(VALIDATORS.admin_password('abcd')).toBe(true);
    expect(VALIDATORS.admin_password('abc')).toBe(false);
  });
});
