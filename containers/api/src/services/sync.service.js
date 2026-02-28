/**
 * LINBO Docker - Sync Service (DB-free)
 *
 * Syncs data from the LMN Authority API to local files + Redis cache.
 * Triggered manually via POST /api/v1/sync/trigger.
 *
 * Data flow:
 *   1. Fetch delta changes from LMN Authority API
 *   2. Write start.conf files (with server= rewrite) + MD5 + symlinks
 *   3. Cache configs/hosts in Redis (for GRUB generator)
 *   4. Regenerate GRUB configs
 *   5. Update DHCP export (inotify-watched by dhcp container)
 */

const fsp = require('fs/promises');
const path = require('path');
const redis = require('../lib/redis');
const lmnClient = require('../lib/lmn-api-client');
const { atomicWrite, atomicWriteWithMd5, safeUnlink, forceSymlink } = require('../lib/atomic-write');
const { rewriteServerField } = require('../lib/startconf-rewrite');
const grubGenerator = require('./grub-generator');
const ws = require('../lib/websocket');

const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const DHCP_DIR = path.join(LINBO_DIR, 'dhcp');
const DHCP_CONFIG_FILE = path.join(DHCP_DIR, 'dnsmasq-proxy.conf');

// Redis key prefixes
const KEY = {
  CURSOR: 'sync:cursor',
  LAST_SYNC: 'sync:lastSyncAt',
  LAST_ERROR: 'sync:lastError',
  IS_RUNNING: 'sync:isRunning',
  SERVER_IP: 'sync:server_ip',
  HOST: 'sync:host:',        // sync:host:{mac} → JSON
  HOST_INDEX: 'sync:host:index',  // SET of all known MACs
  CONFIG: 'sync:config:',    // sync:config:{id} → JSON
  CONFIG_INDEX: 'sync:config:index', // SET of all known config IDs
  DHCP_ETAG: 'sync:dhcp:etag',
};

/**
 * Run a single sync cycle. Idempotent — safe to call multiple times.
 * @returns {Promise<{success: boolean, stats: object}>}
 */
async function syncOnce() {
  const client = redis.getClient();

  // Guard: only one sync at a time
  const running = await client.get(KEY.IS_RUNNING);
  if (running === 'true') {
    throw new Error('Sync already in progress');
  }

  await client.set(KEY.IS_RUNNING, 'true');
  const startTime = Date.now();

  // Broadcast sync started
  try { ws.broadcast('sync.started', { timestamp: new Date().toISOString() }); } catch {}

  try {
    // 1. Read cursor (empty = full snapshot)
    const cursor = await client.get(KEY.CURSOR) || '';
    const isFullSync = !cursor;

    console.log(`[Sync] Starting ${isFullSync ? 'FULL' : 'incremental'} sync (cursor: ${cursor || '(empty)'})`);

    // 2. Fetch changes
    const delta = await lmnClient.getChanges(cursor);

    const stats = {
      startConfs: 0,
      configs: 0,
      hosts: 0,
      deletedStartConfs: 0,
      deletedHosts: 0,
      dhcp: false,
      grub: false,
    };

    const settingsService = require('./settings.service');
    const serverIp = await settingsService.get('linbo_server_ip');

    // Check if server IP changed → force full rewrite of start.confs
    const lastServerIp = await client.get(KEY.SERVER_IP);
    const serverIpChanged = lastServerIp && lastServerIp !== serverIp;
    if (serverIpChanged) {
      console.log(`[Sync] Server IP changed (${lastServerIp} → ${serverIp}), will rewrite all start.confs`);
    }

    // 3. Sync start.confs (raw content + server= rewrite)
    if (delta.startConfsChanged.length > 0) {
      const { startConfs } = await lmnClient.batchGetStartConfs(delta.startConfsChanged);
      for (const sc of startConfs) {
        const rewritten = rewriteServerField(sc.content, serverIp);
        const filepath = path.join(LINBO_DIR, `start.conf.${sc.id}`);
        await atomicWriteWithMd5(filepath, rewritten);
        stats.startConfs++;
      }
      console.log(`[Sync] Wrote ${stats.startConfs} start.conf files`);
      try { ws.broadcast('sync.progress', { phase: 'startConfs', stats: { startConfs: stats.startConfs } }); } catch {}
    }

    // 4. Sync configs (parsed, cached in Redis for GRUB generator)
    // Merge startConfsChanged into configsChanged — a start.conf change always
    // means the parsed config changed too (they derive from the same file).
    const allConfigsChanged = [...new Set([...delta.configsChanged, ...delta.startConfsChanged])];
    if (allConfigsChanged.length > 0) {
      const { configs } = await lmnClient.batchGetConfigs(allConfigsChanged);
      for (const config of configs) {
        await client.set(`${KEY.CONFIG}${config.id}`, JSON.stringify(config));
        await client.sadd(KEY.CONFIG_INDEX, config.id);
        stats.configs++;
      }
      console.log(`[Sync] Cached ${stats.configs} config records`);
    }

    // 5. Sync hosts (cached in Redis, create start.conf symlinks)
    if (delta.hostsChanged.length > 0) {
      const { hosts } = await lmnClient.batchGetHosts(delta.hostsChanged);
      for (const host of hosts) {
        await client.set(`${KEY.HOST}${host.mac}`, JSON.stringify(host));
        await client.sadd(KEY.HOST_INDEX, host.mac);

        // Create start.conf symlinks
        const groupFile = `start.conf.${host.hostgroup}`;
        if (host.ip) {
          await forceSymlink(groupFile, path.join(LINBO_DIR, `start.conf-${host.ip}`));
        }
        if (host.mac) {
          const macLower = host.mac.toLowerCase();
          await forceSymlink(groupFile, path.join(LINBO_DIR, `start.conf-${macLower}`));
        }
        stats.hosts++;
      }
      console.log(`[Sync] Cached ${stats.hosts} host records + symlinks`);
      try { ws.broadcast('sync.progress', { phase: 'hosts', stats: { hosts: stats.hosts } }); } catch {}
    }

    // 6. Handle deletions — start.confs
    if (delta.deletedStartConfs.length > 0) {
      for (const id of delta.deletedStartConfs) {
        await safeUnlink(path.join(LINBO_DIR, `start.conf.${id}`));
        await safeUnlink(path.join(LINBO_DIR, `start.conf.${id}.md5`));
        await client.del(`${KEY.CONFIG}${id}`);
        await client.srem(KEY.CONFIG_INDEX, id);
        stats.deletedStartConfs++;
      }
      console.log(`[Sync] Deleted ${stats.deletedStartConfs} start.conf files`);
    }

    // 7. Handle deletions — hosts
    if (delta.deletedHosts.length > 0) {
      for (const mac of delta.deletedHosts) {
        // Read host data before deleting to clean up symlinks
        const hostJson = await client.get(`${KEY.HOST}${mac}`);
        if (hostJson) {
          const host = JSON.parse(hostJson);
          if (host.ip) await safeUnlink(path.join(LINBO_DIR, `start.conf-${host.ip}`));
          if (host.mac) await safeUnlink(path.join(LINBO_DIR, `start.conf-${host.mac.toLowerCase()}`));
        }
        await client.del(`${KEY.HOST}${mac}`);
        await client.srem(KEY.HOST_INDEX, mac);
        stats.deletedHosts++;
      }
      console.log(`[Sync] Deleted ${stats.deletedHosts} host records + symlinks`);
    }

    // 8. Full snapshot reconciliation — delete local items NOT in the response
    if (isFullSync) {
      await reconcileFullSnapshot(client, delta, stats);
    }

    // 9. DHCP export (conditional GET with ETag)
    if (delta.dhcpChanged) {
      const currentEtag = await client.get(KEY.DHCP_ETAG);
      const dhcpResult = await lmnClient.getDhcpExport(currentEtag);

      if (dhcpResult.status === 200) {
        await atomicWrite(DHCP_CONFIG_FILE, dhcpResult.content);
        if (dhcpResult.etag) {
          await client.set(KEY.DHCP_ETAG, dhcpResult.etag);
        }
        stats.dhcp = true;
        console.log('[Sync] DHCP export updated (inotify will reload dnsmasq)');
      } else {
        console.log('[Sync] DHCP export unchanged (304 Not Modified)');
      }
    }

    // 10. Regenerate GRUB configs from Redis-cached data
    const hasChanges = stats.startConfs > 0 || stats.configs > 0 || stats.hosts > 0
      || stats.deletedStartConfs > 0 || stats.deletedHosts > 0;

    if (hasChanges || isFullSync) {
      const allHosts = await loadAllHostsFromRedis(client);
      const allConfigs = await loadAllConfigsFromRedis(client);

      const changedConfigIds = delta.configsChanged.length > 0 && !isFullSync
        ? delta.configsChanged
        : undefined;

      await grubGenerator.regenerateAll(allHosts, allConfigs, {
        server: serverIp,
        changedConfigIds,
      });
      stats.grub = true;
    }

    // 11. Save cursor + metadata
    await client.set(KEY.CURSOR, delta.nextCursor);
    await client.set(KEY.SERVER_IP, serverIp);
    await client.set(KEY.LAST_SYNC, new Date().toISOString());
    await client.set(KEY.LAST_ERROR, '');

    const elapsed = Date.now() - startTime;
    console.log(`[Sync] Completed in ${elapsed}ms: ${JSON.stringify(stats)}`);

    // Broadcast completion event
    try { ws.broadcast('sync.completed', { stats, elapsed, cursor: delta.nextCursor }); } catch {}

    return { success: true, stats };
  } catch (err) {
    console.error('[Sync] Failed:', err.message);
    await client.set(KEY.LAST_ERROR, err.message);
    // Do NOT update cursor on failure — next trigger retries
    try { ws.broadcast('sync.failed', { error: err.message }); } catch {}
    throw err;
  } finally {
    await client.set(KEY.IS_RUNNING, 'false');
  }
}

/**
 * Full snapshot reconciliation: delete local items NOT in the response.
 */
async function reconcileFullSnapshot(client, delta, stats) {
  console.log('[Sync] Running full snapshot reconciliation...');

  // Reconcile start.conf files on disk
  const validConfIds = new Set(delta.startConfsChanged);
  try {
    const files = await fsp.readdir(LINBO_DIR);
    for (const file of files) {
      if (!file.startsWith('start.conf.') || file.endsWith('.md5') || file.endsWith('.bak')) continue;
      const confId = file.replace('start.conf.', '');
      if (!validConfIds.has(confId)) {
        await safeUnlink(path.join(LINBO_DIR, file));
        await safeUnlink(path.join(LINBO_DIR, `${file}.md5`));
        console.log(`[Sync] Reconcile: removed stale ${file}`);
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[Sync] Reconcile readdir error:', err.message);
  }

  // Reconcile host Redis entries
  const validMacs = new Set(delta.hostsChanged);
  const existingMacs = await client.smembers(KEY.HOST_INDEX);
  for (const mac of existingMacs) {
    if (!validMacs.has(mac)) {
      const hostJson = await client.get(`${KEY.HOST}${mac}`);
      if (hostJson) {
        const host = JSON.parse(hostJson);
        if (host.ip) await safeUnlink(path.join(LINBO_DIR, `start.conf-${host.ip}`));
        if (host.mac) await safeUnlink(path.join(LINBO_DIR, `start.conf-${host.mac.toLowerCase()}`));
      }
      await client.del(`${KEY.HOST}${mac}`);
      await client.srem(KEY.HOST_INDEX, mac);
    }
  }

  // Reconcile config Redis entries
  const validConfigIds = new Set(delta.configsChanged);
  const existingConfigIds = await client.smembers(KEY.CONFIG_INDEX);
  for (const id of existingConfigIds) {
    if (!validConfigIds.has(id)) {
      await client.del(`${KEY.CONFIG}${id}`);
      await client.srem(KEY.CONFIG_INDEX, id);
    }
  }

  // Clean up stale start.conf-{ip} and start.conf-{mac} symlinks
  try {
    const files = await fsp.readdir(LINBO_DIR);
    const validIps = new Set();
    const validMacLower = new Set();

    // Build sets of valid IPs and MACs from the current host data
    for (const mac of delta.hostsChanged) {
      const hostJson = await client.get(`${KEY.HOST}${mac}`);
      if (hostJson) {
        const host = JSON.parse(hostJson);
        if (host.ip) validIps.add(host.ip);
        if (host.mac) validMacLower.add(host.mac.toLowerCase());
      }
    }

    for (const file of files) {
      if (!file.startsWith('start.conf-')) continue;
      const suffix = file.replace('start.conf-', '');
      // It's an IP symlink if suffix looks like an IP, else MAC
      if (suffix.includes('.')) {
        if (!validIps.has(suffix)) {
          await safeUnlink(path.join(LINBO_DIR, file));
        }
      } else if (suffix.includes(':')) {
        if (!validMacLower.has(suffix)) {
          await safeUnlink(path.join(LINBO_DIR, file));
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[Sync] Reconcile symlink cleanup error:', err.message);
  }
}

/**
 * Load all hosts from Redis cache.
 */
async function loadAllHostsFromRedis(client) {
  const macs = await client.smembers(KEY.HOST_INDEX);
  if (macs.length === 0) return [];

  const pipeline = client.pipeline();
  for (const mac of macs) {
    pipeline.get(`${KEY.HOST}${mac}`);
  }
  const results = await pipeline.exec();
  return results
    .filter(([err, val]) => !err && val)
    .map(([, val]) => JSON.parse(val));
}

/**
 * Load all configs from Redis cache.
 */
async function loadAllConfigsFromRedis(client) {
  const ids = await client.smembers(KEY.CONFIG_INDEX);
  if (ids.length === 0) return [];

  const pipeline = client.pipeline();
  for (const id of ids) {
    pipeline.get(`${KEY.CONFIG}${id}`);
  }
  const results = await pipeline.exec();
  return results
    .filter(([err, val]) => !err && val)
    .map(([, val]) => JSON.parse(val));
}

/**
 * Get current sync status.
 */
async function getSyncStatus() {
  const client = redis.getClient();
  const [cursor, lastSyncAt, lastError, isRunning, serverIp] = await client.mget(
    KEY.CURSOR, KEY.LAST_SYNC, KEY.LAST_ERROR, KEY.IS_RUNNING, KEY.SERVER_IP,
  );

  const hostCount = await client.scard(KEY.HOST_INDEX);
  const configCount = await client.scard(KEY.CONFIG_INDEX);

  let lmnApiHealthy = false;
  try {
    const health = await lmnClient.checkHealth();
    lmnApiHealthy = health.healthy;
  } catch {}

  return {
    cursor: cursor || null,
    lastSyncAt: lastSyncAt || null,
    lastError: lastError || null,
    isRunning: isRunning === 'true',
    serverIp: serverIp || null,
    hostCount: Number(hostCount),
    configCount: Number(configCount),
    lmnApiHealthy,
  };
}

/**
 * Reset sync: clear cursor to force full snapshot on next trigger.
 */
async function resetSync() {
  const client = redis.getClient();
  await client.del(KEY.CURSOR);
  console.log('[Sync] Cursor reset — next sync will be a full snapshot');
}

module.exports = {
  syncOnce,
  getSyncStatus,
  resetSync,
  // Exported for testing
  loadAllHostsFromRedis,
  loadAllConfigsFromRedis,
  reconcileFullSnapshot,
  KEY,
};
