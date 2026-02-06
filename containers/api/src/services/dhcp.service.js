/**
 * LINBO Docker - DHCP Service
 *
 * Generates DHCP configuration files for ISC DHCP and dnsmasq.
 * Manages network settings via Redis with ENV defaults.
 * Provides stale-detection to indicate when exports are outdated.
 */

const { prisma } = require('../lib/prisma');
const redis = require('../lib/redis');

const REDIS_KEY = 'system:network-settings';

// =============================================================================
// Network Settings
// =============================================================================

/**
 * Default network settings from environment variables
 */
function getDefaults() {
  return {
    serverIp: process.env.LINBO_SERVER_IP || '10.0.0.1',
    subnet: process.env.LINBO_SUBNET || '10.0.0.0',
    netmask: process.env.LINBO_NETMASK || '255.255.0.0',
    gateway: process.env.LINBO_GATEWAY || '10.0.0.254',
    dns: process.env.LINBO_DNS || '10.0.0.1',
    domain: process.env.LINBO_DOMAIN || 'linuxmuster.lan',
    dhcpRangeStart: '',
    dhcpRangeEnd: '',
    defaultLeaseTime: 86400,
    maxLeaseTime: 172800,
  };
}

/**
 * Get network settings (from Redis or ENV defaults)
 */
async function getNetworkSettings() {
  const stored = await redis.get(REDIS_KEY);
  const defaults = getDefaults();

  if (!stored) {
    return { ...defaults, lastExportedAt: null };
  }

  return { ...defaults, ...stored };
}

/**
 * Save network settings to Redis
 */
async function saveNetworkSettings(settings) {
  const current = await getNetworkSettings();
  const merged = {
    ...current,
    ...settings,
    updatedAt: new Date().toISOString(),
  };

  // Don't persist lastExportedAt through saves - keep it separate
  await redis.set(REDIS_KEY, merged);

  return merged;
}

/**
 * Update the lastExportedAt timestamp
 */
async function markExported() {
  const current = await getNetworkSettings();
  current.lastExportedAt = new Date().toISOString();
  await redis.set(REDIS_KEY, current);
  return current;
}

// =============================================================================
// Host Queries
// =============================================================================

/**
 * Get hosts for DHCP config generation
 */
async function getHostsForDhcp(options = {}) {
  const { configId, roomId, pxeOnly } = options;

  const where = {};
  if (configId) where.configId = configId;
  if (roomId) where.roomId = roomId;

  const hosts = await prisma.host.findMany({
    where,
    include: {
      config: true,
      room: true,
    },
    orderBy: [
      { config: { name: 'asc' } },
      { hostname: 'asc' },
    ],
  });

  if (pxeOnly) {
    return hosts.filter((h) => h.configId && getPxeFlag(h) > 0);
  }

  return hosts;
}

/**
 * Get PXE flag from host metadata (default: 1 = PXE enabled)
 */
function getPxeFlag(host) {
  if (host.metadata && typeof host.metadata.pxeFlag === 'number') {
    return host.metadata.pxeFlag;
  }
  // Default: PXE enabled if host has a config
  return host.configId ? 1 : 0;
}

/**
 * Check if a host should get PXE options
 */
function isPxeEnabled(host) {
  return !!(host.configId && getPxeFlag(host) > 0);
}

// =============================================================================
// ISC DHCP Generation
// =============================================================================

/**
 * Generate ISC DHCP configuration
 */
async function generateIscDhcpConfig(options = {}) {
  const { includeHeader = true, includeSubnet = true } = options;
  const settings = await getNetworkSettings();
  const hosts = await getHostsForDhcp(options);

  const lines = [];

  // Global header
  if (includeHeader) {
    lines.push('#');
    lines.push('# LINBO Docker - ISC DHCP Configuration');
    lines.push(`# Generated: ${new Date().toISOString()}`);
    lines.push(`# Hosts: ${hosts.length}`);
    lines.push('#');
    lines.push('');
    lines.push('# Architecture detection for PXE boot');
    lines.push('option arch code 93 = unsigned integer 16;');
    lines.push('');
    lines.push('# LINBO TFTP boot settings');
    lines.push(`next-server ${settings.serverIp};`);
    lines.push('');
    lines.push('if option arch = 00:06 {');
    lines.push('  filename "boot/grub/i386-efi/core.efi";');
    lines.push('} else if option arch = 00:07 {');
    lines.push('  filename "boot/grub/x86_64-efi/core.efi";');
    lines.push('} else if option arch = 00:09 {');
    lines.push('  filename "boot/grub/x86_64-efi/core.efi";');
    lines.push('} else {');
    lines.push('  filename "boot/grub/i386-pc/core.0";');
    lines.push('}');
    lines.push('');
  }

  // Subnet block
  if (includeSubnet) {
    lines.push(`subnet ${settings.subnet} netmask ${settings.netmask} {`);
    if (settings.dhcpRangeStart && settings.dhcpRangeEnd) {
      lines.push(`  range ${settings.dhcpRangeStart} ${settings.dhcpRangeEnd};`);
    }
    lines.push(`  option routers ${settings.gateway};`);
    lines.push(`  option domain-name-servers ${settings.dns};`);
    lines.push(`  option domain-name "${settings.domain}";`);
    lines.push(`  default-lease-time ${settings.defaultLeaseTime};`);
    lines.push(`  max-lease-time ${settings.maxLeaseTime};`);
    lines.push('');
  }

  // Group hosts by config
  const configGroups = groupHostsByConfig(hosts);

  for (const [configName, groupHosts] of configGroups) {
    lines.push(`  # Config: ${configName || 'no-config'}`);
    lines.push(`  # Hosts: ${groupHosts.length}`);

    for (const host of groupHosts) {
      lines.push(`  host ${host.hostname} {`);
      lines.push(`    hardware ethernet ${host.macAddress};`);

      if (host.ipAddress) {
        lines.push(`    fixed-address ${host.ipAddress};`);
      }

      lines.push(`    option host-name "${host.hostname}";`);

      if (isPxeEnabled(host)) {
        lines.push(`    option extensions-path "${host.config.name}";`);
        lines.push(`    option nis-domain "${host.config.name}";`);
      }

      lines.push('  }');
      lines.push('');
    }
  }

  if (includeSubnet) {
    lines.push('}');
  }

  return lines.join('\n');
}

// =============================================================================
// dnsmasq Generation
// =============================================================================

/**
 * Generate dnsmasq configuration (full or proxy mode)
 */
async function generateDnsmasqConfig(options = {}) {
  const { mode = 'full' } = options;
  const settings = await getNetworkSettings();
  const hosts = await getHostsForDhcp(options);

  const lines = [];

  lines.push('#');
  lines.push(`# LINBO Docker - dnsmasq Configuration (${mode} mode)`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push(`# Hosts: ${hosts.length}`);
  lines.push('#');
  lines.push('');

  if (mode === 'proxy') {
    return generateDnsmasqProxy(lines, settings, hosts, options);
  }

  return generateDnsmasqFull(lines, settings, hosts, options);
}

/**
 * Generate dnsmasq proxy-DHCP configuration
 * Only handles PXE boot, no IP assignment
 */
function generateDnsmasqProxy(lines, settings, hosts, options) {
  lines.push('# Proxy DHCP mode - no IP assignment, PXE only');
  lines.push('port=0');
  lines.push(`dhcp-range=${settings.subnet},proxy`);
  lines.push('log-dhcp');
  lines.push('');

  // Interface binding
  const iface = options.interface || process.env.DHCP_INTERFACE || 'eth0';
  lines.push(`interface=${iface}`);
  lines.push('bind-interfaces');
  lines.push('');

  // Architecture detection and boot files
  lines.push('# PXE boot architecture detection');
  lines.push('dhcp-match=set:bios,option:client-arch,0');
  lines.push('dhcp-match=set:efi32,option:client-arch,6');
  lines.push('dhcp-match=set:efi64,option:client-arch,7');
  lines.push('dhcp-match=set:efi64,option:client-arch,9');
  lines.push('');
  lines.push(`dhcp-boot=tag:bios,boot/grub/i386-pc/core.0,${settings.serverIp}`);
  lines.push(`dhcp-boot=tag:efi32,boot/grub/i386-efi/core.efi,${settings.serverIp}`);
  lines.push(`dhcp-boot=tag:efi64,boot/grub/x86_64-efi/core.efi,${settings.serverIp}`);
  lines.push('');

  // TFTP server
  lines.push(`# TFTP server`);
  lines.push(`tftp-root=/srv/linbo`);
  lines.push(`enable-tftp`);
  lines.push('');

  // Per-host config tags (only PXE-enabled hosts)
  const pxeHosts = hosts.filter(isPxeEnabled);
  const configGroups = groupHostsByConfig(pxeHosts);

  if (pxeHosts.length > 0) {
    lines.push('# Host config assignments');
    for (const host of pxeHosts) {
      lines.push(`dhcp-host=${host.macAddress},set:${sanitizeTag(host.config.name)}`);
    }
    lines.push('');

    // NIS-Domain option (Option 40) per config tag - once per unique config
    lines.push('# Config name via NIS-Domain (Option 40)');
    for (const [configName] of configGroups) {
      if (configName) {
        lines.push(`dhcp-option=tag:${sanitizeTag(configName)},40,${configName}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate dnsmasq full DHCP configuration
 */
function generateDnsmasqFull(lines, settings, hosts, options) {
  lines.push('# Full DHCP mode');
  lines.push(`domain=${settings.domain}`);
  lines.push('');

  // Interface binding
  const iface = options.interface || process.env.DHCP_INTERFACE || 'eth0';
  lines.push(`interface=${iface}`);
  lines.push('bind-interfaces');
  lines.push('');

  // DHCP range
  if (settings.dhcpRangeStart && settings.dhcpRangeEnd) {
    lines.push(`dhcp-range=${settings.dhcpRangeStart},${settings.dhcpRangeEnd},${settings.netmask},${settings.defaultLeaseTime}s`);
  } else {
    lines.push(`# dhcp-range=<start>,<end>,${settings.netmask},${settings.defaultLeaseTime}s`);
  }
  lines.push('');

  // Default options
  lines.push(`dhcp-option=3,${settings.gateway}`);
  lines.push(`dhcp-option=6,${settings.dns}`);
  lines.push(`dhcp-option=15,${settings.domain}`);
  lines.push('');

  // Architecture detection and boot files
  lines.push('# PXE boot architecture detection');
  lines.push('dhcp-match=set:bios,option:client-arch,0');
  lines.push('dhcp-match=set:efi32,option:client-arch,6');
  lines.push('dhcp-match=set:efi64,option:client-arch,7');
  lines.push('dhcp-match=set:efi64,option:client-arch,9');
  lines.push('');
  lines.push(`dhcp-boot=tag:bios,boot/grub/i386-pc/core.0,${settings.serverIp}`);
  lines.push(`dhcp-boot=tag:efi32,boot/grub/i386-efi/core.efi,${settings.serverIp}`);
  lines.push(`dhcp-boot=tag:efi64,boot/grub/x86_64-efi/core.efi,${settings.serverIp}`);
  lines.push('');

  // TFTP
  lines.push('# TFTP server');
  lines.push('tftp-root=/srv/linbo');
  lines.push('enable-tftp');
  lines.push('log-dhcp');
  lines.push('');

  // Per-host entries
  const pxeHosts = hosts.filter(isPxeEnabled);
  const nonPxeHosts = hosts.filter((h) => !isPxeEnabled(h));
  const configGroups = groupHostsByConfig(pxeHosts);

  if (hosts.length > 0) {
    lines.push('# Static host entries');

    // PXE hosts grouped by config
    for (const [configName, groupHosts] of configGroups) {
      lines.push(`# Config: ${configName}`);
      for (const host of groupHosts) {
        const parts = [host.macAddress];
        if (host.ipAddress) parts.push(host.ipAddress);
        parts.push(host.hostname);
        parts.push(`set:${sanitizeTag(configName)}`);
        lines.push(`dhcp-host=${parts.join(',')}`);
      }
    }

    // Non-PXE hosts
    if (nonPxeHosts.length > 0) {
      lines.push('# Non-PXE hosts');
      for (const host of nonPxeHosts) {
        const parts = [host.macAddress];
        if (host.ipAddress) parts.push(host.ipAddress);
        parts.push(host.hostname);
        lines.push(`dhcp-host=${parts.join(',')}`);
      }
    }
    lines.push('');

    // NIS-Domain option (Option 40) per config tag
    if (pxeHosts.length > 0) {
      lines.push('# Config name via NIS-Domain (Option 40)');
      for (const [configName] of configGroups) {
        if (configName) {
          lines.push(`dhcp-option=tag:${sanitizeTag(configName)},40,${configName}`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// =============================================================================
// Summary & Stale Detection
// =============================================================================

/**
 * Get DHCP export summary with stale detection
 */
async function getDhcpSummary() {
  const settings = await getNetworkSettings();
  const hosts = await prisma.host.findMany({
    include: { config: true },
  });

  const totalHosts = hosts.length;
  const pxeHosts = hosts.filter(isPxeEnabled).length;
  const staticIpHosts = hosts.filter((h) => h.ipAddress).length;
  const dhcpIpHosts = totalHosts - staticIpHosts;

  // Config breakdown
  const configCounts = {};
  for (const host of hosts) {
    const name = host.config?.name || 'no-config';
    configCounts[name] = (configCounts[name] || 0) + 1;
  }

  // Stale detection: compare lastExportedAt with latest host/config update
  const [latestHost, latestConfig] = await Promise.all([
    prisma.host.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    prisma.config.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
  ]);

  const lastChange = Math.max(
    latestHost?.updatedAt?.getTime() || 0,
    latestConfig?.updatedAt?.getTime() || 0
  );
  const lastExported = settings.lastExportedAt
    ? new Date(settings.lastExportedAt).getTime()
    : 0;

  const isStale = lastChange > lastExported;

  return {
    totalHosts,
    pxeHosts,
    staticIpHosts,
    dhcpIpHosts,
    configCounts,
    lastExportedAt: settings.lastExportedAt,
    lastChangedAt: lastChange ? new Date(lastChange).toISOString() : null,
    isStale,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Group hosts by config name (ordered map)
 */
function groupHostsByConfig(hosts) {
  const groups = new Map();
  for (const host of hosts) {
    const name = host.config?.name || 'no-config';
    if (!groups.has(name)) {
      groups.set(name, []);
    }
    groups.get(name).push(host);
  }
  return groups;
}

/**
 * Sanitize a string for use as a dnsmasq tag
 */
function sanitizeTag(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

module.exports = {
  // Network settings
  getNetworkSettings,
  saveNetworkSettings,
  markExported,
  getDefaults,

  // Host queries
  getHostsForDhcp,
  getPxeFlag,
  isPxeEnabled,

  // Config generation
  generateIscDhcpConfig,
  generateDnsmasqConfig,

  // Summary
  getDhcpSummary,

  // Helpers (exported for testing)
  groupHostsByConfig,
  sanitizeTag,

  // Constants
  REDIS_KEY,
};
