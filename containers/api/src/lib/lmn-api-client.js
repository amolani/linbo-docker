/**
 * LINBO Docker - LMN Authority API Client
 * HTTP client for fetching data from the linuxmuster.net Authority API
 */

const REQUEST_TIMEOUT = 10_000;
const MAX_RETRIES = 3;
const BASE_DELAY = 500;

let _settings;
function getSettings() {
  if (!_settings) _settings = require('../services/settings.service');
  return _settings;
}

/**
 * Make an authenticated request to the LMN Authority API with retries
 * @param {string} path - API path (e.g., '/api/v1/linbo/changes')
 * @param {object} options - fetch options
 * @returns {Promise<Response>}
 */
async function request(path, options = {}) {
  const lmnApiUrl = await getSettings().get('lmn_api_url');
  const lmnApiKey = await getSettings().get('lmn_api_key');
  const url = `${lmnApiUrl}${path}`;
  const headers = {
    'Authorization': `Bearer ${lmnApiKey}`,
    'Accept': 'application/json',
    ...options.headers,
  };

  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      // Don't retry on client errors (4xx) except 429
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return response;
      }

      // Retry on 429 and 5xx
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        if (attempt < MAX_RETRIES - 1) {
          const delay = BASE_DELAY * Math.pow(2, attempt);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        return response;
      }

      return response;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Get changes since cursor (delta feed)
 * @param {string} cursor - Cursor from previous sync, or '' for full snapshot
 * @returns {Promise<{nextCursor, hostsChanged, startConfsChanged, configsChanged, dhcpChanged, deletedHosts, deletedStartConfs}>}
 */
async function getChanges(cursor = '') {
  const response = await request(`/api/v1/linbo/changes?since=${encodeURIComponent(cursor)}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`getChanges failed (${response.status}): ${body}`);
  }
  return response.json();
}

/**
 * Batch fetch host records by MAC address
 * @param {string[]} macs - Array of MAC addresses
 * @returns {Promise<{hosts: HostRecord[]}>}
 */
async function batchGetHosts(macs) {
  const response = await request('/api/v1/linbo/hosts:batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ macs }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`batchGetHosts failed (${response.status}): ${body}`);
  }
  return response.json();
}

/**
 * Batch fetch start.conf content by ID
 * @param {string[]} ids - Array of start.conf IDs (hostgroup names)
 * @returns {Promise<{startConfs: StartConfRecord[]}>}
 */
async function batchGetStartConfs(ids) {
  const response = await request('/api/v1/linbo/startconfs:batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`batchGetStartConfs failed (${response.status}): ${body}`);
  }
  return response.json();
}

/**
 * Batch fetch parsed config records by ID
 * @param {string[]} ids - Array of config IDs
 * @returns {Promise<{configs: ConfigRecord[]}>}
 */
async function batchGetConfigs(ids) {
  const response = await request('/api/v1/linbo/configs:batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`batchGetConfigs failed (${response.status}): ${body}`);
  }
  return response.json();
}

/**
 * Get DHCP dnsmasq-proxy export with ETag support
 * @param {string|null} etag - Previous ETag for conditional GET
 * @returns {Promise<{status: number, content: string|null, etag: string|null}>}
 */
async function getDhcpExport(etag = null) {
  const headers = { 'Accept': 'text/plain' };
  if (etag) {
    headers['If-None-Match'] = etag;
  }

  const response = await request('/api/v1/linbo/dhcp/export/dnsmasq-proxy', { headers });

  if (response.status === 304) {
    return { status: 304, content: null, etag };
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`getDhcpExport failed (${response.status}): ${body}`);
  }

  const content = await response.text();
  const newEtag = response.headers.get('etag') || null;

  return { status: 200, content, etag: newEtag };
}

/**
 * Check LMN Authority API health
 * @returns {Promise<{healthy: boolean, status?: string, version?: string}>}
 */
async function checkHealth() {
  try {
    const response = await request('/health');
    if (!response.ok) {
      return { healthy: false };
    }
    const data = await response.json();
    return { healthy: data.status === 'ok', status: data.status, version: data.version };
  } catch {
    return { healthy: false };
  }
}

module.exports = {
  getChanges,
  batchGetHosts,
  batchGetStartConfs,
  batchGetConfigs,
  getDhcpExport,
  checkHealth,
};
