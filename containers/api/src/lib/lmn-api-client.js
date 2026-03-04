/**
 * LINBO Docker - LMN API Client
 * HTTP client for fetching LINBO data from linuxmuster-api (port 8001)
 * or the legacy Authority API (port 8400).
 *
 * Auth mode is auto-detected from the configured URL:
 *   - Port 8001 (linuxmuster-api): JWT auth via /v1/auth, paths under /v1/linbo/
 *   - Port 8400 (Authority API):   Static Bearer token, paths under /api/v1/linbo/
 */

const REQUEST_TIMEOUT = 10_000;
const MAX_RETRIES = 3;
const BASE_DELAY = 500;

let _settings;
function getSettings() {
  if (!_settings) _settings = require('../services/settings.service');
  return _settings;
}

// JWT token cache for linuxmuster-api mode
let _jwtToken = null;
let _jwtExpiry = 0;

/**
 * Detect API mode from URL (linuxmuster-api vs legacy Authority API)
 * @param {string} baseUrl
 * @returns {{ pathPrefix: string, useJwt: boolean }}
 */
function _detectMode(baseUrl) {
  try {
    const url = new URL(baseUrl);
    if (url.port === '8001') {
      return { pathPrefix: '/v1/linbo', useJwt: true };
    }
  } catch { /* fall through */ }
  return { pathPrefix: '/api/v1/linbo', useJwt: false };
}

/**
 * Get JWT token for linuxmuster-api via HTTP Basic Auth (cached, auto-refreshes)
 * linuxmuster-api uses GET /v1/auth/ with HTTP Basic Auth, returns a bare JWT string.
 * @param {string} baseUrl
 * @returns {Promise<string>}
 */
async function _getJwtToken(baseUrl) {
  // Return cached token if still valid (5min buffer)
  if (_jwtToken && Date.now() < _jwtExpiry - 300_000) {
    return _jwtToken;
  }

  const lmnUser = await getSettings().get('lmn_api_user');
  const lmnPass = await getSettings().get('lmn_api_password');

  if (!lmnUser || !lmnPass) {
    throw new Error(
      'lmn_api_user and lmn_api_password required for linuxmuster-api (port 8001). ' +
      'Set via settings API or use port 8400 with lmn_api_key for legacy mode.'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  // linuxmuster-api auth: GET with HTTP Basic Auth, returns bare JWT string
  const basicAuth = Buffer.from(`${lmnUser}:${lmnPass}`).toString('base64');
  const response = await fetch(`${baseUrl}/v1/auth/`, {
    headers: { 'Authorization': `Basic ${basicAuth}` },
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`JWT login failed (${response.status}): ${body}`);
  }

  // Response is a bare JWT string (quoted), not a JSON object
  const raw = await response.text();
  _jwtToken = raw.replace(/^"|"$/g, '');
  // Default 1h expiry
  _jwtExpiry = Date.now() + 3600 * 1000;

  return _jwtToken;
}

/**
 * Make an authenticated request to the LMN API with retries
 * @param {string} path - API path (without base URL, e.g., '/changes')
 * @param {object} options - fetch options
 * @returns {Promise<Response>}
 */
async function request(path, options = {}) {
  const lmnApiUrl = await getSettings().get('lmn_api_url');
  const { pathPrefix, useJwt } = _detectMode(lmnApiUrl);

  let token;
  if (useJwt) {
    token = await _getJwtToken(lmnApiUrl);
  } else {
    token = await getSettings().get('lmn_api_key');
  }

  const url = `${lmnApiUrl}${pathPrefix}${path}`;
  // linuxmuster-api uses X-API-Key header; legacy Authority API uses Authorization: Bearer
  const authHeader = useJwt
    ? { 'X-API-Key': token }
    : { 'Authorization': `Bearer ${token}` };
  const headers = {
    ...authHeader,
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

      // On 401 with JWT mode, clear token cache and retry once
      if (response.status === 401 && useJwt && attempt === 0) {
        _jwtToken = null;
        _jwtExpiry = 0;
        token = await _getJwtToken(lmnApiUrl);
        headers['X-API-Key'] = token;
        continue;
      }

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
  const response = await request(`/changes?since=${encodeURIComponent(cursor)}`);
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
  const response = await request('/hosts:batch', {
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
  const response = await request('/startconfs:batch', {
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
  const response = await request('/configs:batch', {
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

  const response = await request('/dhcp/export/dnsmasq-proxy', { headers });

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
 * Check LMN API health
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
