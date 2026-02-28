/**
 * LINBO Docker - Settings Service
 *
 * Runtime-configurable settings stored in Redis with env-var fallback.
 * Keys: config:{key} (String, no TTL).
 *
 * Security:
 *   - admin_password → bcrypt hash stored as config:admin_password_hash
 *   - lmn_api_key → plaintext in Redis (needed for API calls), masked in getAll()
 */

const bcrypt = require('bcryptjs');
const redis = require('../lib/redis');
const ws = require('../lib/websocket');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SETTINGS = {
  lmn_api_url:          { env: 'LMN_API_URL',      default: 'http://10.0.0.11:8000', secret: false, description: 'Authority API URL' },
  lmn_api_key:          { env: 'LMN_API_KEY',      default: '',                      secret: true,  description: 'Authority API Key' },
  linbo_server_ip:      { env: 'LINBO_SERVER_IP',   default: '10.0.0.1',             secret: false, description: 'LINBO Server IP' },
  admin_password:       { env: null,                default: null,                    secret: true,  description: 'Admin-Passwort',    writeOnly: true },
  admin_password_hash:  { env: null,                default: null,                    secret: true,  description: 'Admin-Passwort',    readOnly: true },
  sync_interval:        { env: 'SYNC_INTERVAL',     default: '0',                    secret: false, description: 'Auto-Sync Intervall (Sekunden)' },
};

// Map from API key → Redis key
function redisKey(key) {
  if (key === 'admin_password') return 'config:admin_password_hash';
  return `config:${key}`;
}

// ---------------------------------------------------------------------------
// In-Memory Cache (2s TTL)
// ---------------------------------------------------------------------------

const cache = new Map();
const CACHE_TTL = 2000;

function invalidateCache(key) {
  if (key) {
    cache.delete(key);
    // admin_password and admin_password_hash share the same Redis key
    if (key === 'admin_password') cache.delete('admin_password_hash');
    if (key === 'admin_password_hash') cache.delete('admin_password');
  } else {
    cache.clear();
  }
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const VALIDATORS = {
  lmn_api_url: (v) => {
    try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; }
    catch { return false; }
  },
  lmn_api_key: () => true,
  linbo_server_ip: (v) => /^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split('.').every(o => +o <= 255),
  admin_password: (v) => v.length >= 4,
  sync_interval: (v) => /^\d+$/.test(String(v)) && Number(v) >= 0,
};

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Get a setting value. Cache → Redis → env → default.
 */
async function get(key) {
  // Normalize: reading admin_password_hash uses the same Redis key
  const lookupKey = key === 'admin_password_hash' ? 'admin_password_hash' : key;
  const schema = SETTINGS[lookupKey];
  if (!schema) throw new Error(`Unknown setting: ${key}`);

  // Cache check
  const cached = cache.get(lookupKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.value;

  const client = redis.getClient();
  const rKey = redisKey(lookupKey);
  let value = await client.get(rKey);

  if (value === null && schema.env) {
    value = process.env[schema.env] ?? null;
  }
  if (value === null) {
    value = schema.default;
  }

  cache.set(lookupKey, { value, ts: Date.now() });
  return value;
}

/**
 * Set a setting value. Validates, hashes passwords, stores in Redis, broadcasts.
 */
async function set(key, value) {
  if (key === 'admin_password_hash') {
    throw new Error('Cannot set admin_password_hash directly. Use admin_password instead.');
  }
  const schema = SETTINGS[key];
  if (!schema) throw new Error(`Unknown setting: ${key}`);
  if (schema.readOnly) throw new Error(`Setting ${key} is read-only`);

  // Trim + validate
  value = String(value).trim();
  const validator = VALIDATORS[key];
  if (validator && !validator(value)) {
    throw new Error(`Invalid value for ${key}`);
  }

  const client = redis.getClient();
  const rKey = redisKey(key);

  if (key === 'admin_password') {
    // Store bcrypt hash
    const hash = await bcrypt.hash(value, 10);
    await client.set(rKey, hash);
  } else {
    await client.set(rKey, value);
  }

  invalidateCache(key);

  // Broadcast change
  try { ws.broadcast('settings.changed', { key }); } catch {}

  // Special: sync_interval → restart timer
  if (key === 'sync_interval') {
    await applySyncInterval();
  }
}

/**
 * Reset a setting to default (delete from Redis).
 */
async function reset(key) {
  if (key === 'admin_password') key = 'admin_password_hash';
  const schema = SETTINGS[key];
  if (!schema) throw new Error(`Unknown setting: ${key}`);

  const client = redis.getClient();
  await client.del(redisKey(key));
  invalidateCache(key);

  try { ws.broadcast('settings.changed', { key }); } catch {}

  if (key === 'sync_interval') {
    await applySyncInterval();
  }
}

/**
 * Get all settings with source info. Secrets are masked.
 */
async function getAll() {
  const client = redis.getClient();
  const result = [];

  for (const [key, schema] of Object.entries(SETTINGS)) {
    if (schema.writeOnly) continue; // skip admin_password (write-only alias)

    const rKey = redisKey(key);
    const redisVal = await client.get(rKey);
    let source = 'default';
    let rawValue = schema.default;

    if (redisVal !== null) {
      source = 'redis';
      rawValue = redisVal;
    } else if (schema.env && process.env[schema.env]) {
      source = 'env';
      rawValue = process.env[schema.env];
    }

    const isSet = source !== 'default';
    const entry = { key, source, isSet, description: schema.description };

    if (key === 'admin_password_hash') {
      // Never expose hash value
      entry.isSet = isSet;
    } else if (key === 'lmn_api_key') {
      if (rawValue && rawValue.length > 0) {
        entry.valueMasked = rawValue.length > 4
          ? '****' + rawValue.slice(-4)
          : '****';
      } else {
        entry.valueMasked = '';
      }
    } else {
      entry.value = rawValue != null ? String(rawValue) : '';
    }

    result.push(entry);
  }

  return result;
}

/**
 * Check admin password against stored hash or env fallback.
 */
async function checkAdminPassword(input) {
  const client = redis.getClient();
  const hash = await client.get('config:admin_password_hash');

  if (hash) {
    return bcrypt.compare(input, hash);
  }

  // Fallback: env var (plaintext comparison)
  const envPass = process.env.ADMIN_PASSWORD;
  if (envPass) {
    return input === envPass;
  }

  return false;
}

/**
 * Return a plain object snapshot of all current values (for job-start freezing).
 */
async function snapshot() {
  const snap = {};
  for (const key of Object.keys(SETTINGS)) {
    if (SETTINGS[key].writeOnly || SETTINGS[key].readOnly) continue;
    snap[key] = await get(key);
  }
  return snap;
}

// ---------------------------------------------------------------------------
// Auto-Sync Timer
// ---------------------------------------------------------------------------

let syncTimer = null;

async function applySyncInterval() {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  const interval = Number(await get('sync_interval'));
  if (interval > 0) {
    syncTimer = setInterval(async () => {
      try {
        const syncService = require('./sync.service');
        await syncService.syncOnce();
      } catch (err) { console.error('[AutoSync]', err.message); }
    }, interval * 1000);
    console.log(`[Settings] Auto-sync every ${interval}s`);
  }
}

module.exports = {
  get,
  set,
  reset,
  getAll,
  checkAdminPassword,
  invalidateCache,
  snapshot,
  applySyncInterval,
  // Exported for tests
  SETTINGS,
  VALIDATORS,
};
