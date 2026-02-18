/**
 * LINBO Docker - Config Service
 * Config deployment and symlink management
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { prisma } = require('../lib/prisma');

const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';

/**
 * Case-insensitive lookup for linboSettings
 * Frontend uses lowercase, start.conf uses PascalCase
 */
function getLinboSetting(settings, key) {
  if (!settings) return undefined;
  // Try exact key first
  if (settings[key] !== undefined) return settings[key];
  // Try lowercase
  const lowerKey = key.toLowerCase();
  if (settings[lowerKey] !== undefined) return settings[lowerKey];
  // Try all keys case-insensitively
  for (const k of Object.keys(settings)) {
    if (k.toLowerCase() === lowerKey) return settings[k];
  }
  return undefined;
}

/**
 * Convert value to yes/no string for start.conf
 */
function toYesNo(value) {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'yes' || lower === 'true' || lower === '1') return 'yes';
    if (lower === 'no' || lower === 'false' || lower === '0') return 'no';
    return value;
  }
  return value ? 'yes' : 'no';
}

/**
 * Convert partition ID to hex string (without 0x prefix)
 * Preserves canonical form: lowercase, no 0x prefix, leading zeros kept as-is
 */
function toHexId(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return value.toString(16);
  if (typeof value === 'string') {
    const stripped = value.replace(/^0x/i, '').toLowerCase();
    if (/^[0-9a-f]+$/.test(stripped)) return stripped;
  }
  return String(value);
}

/**
 * Generate start.conf content from database config
 * Matches production linuxmuster.net 7.3 format exactly
 * @param {string} configId - Config UUID
 * @returns {Promise<{content: string, config: object}>}
 */
async function generateStartConf(configId) {
  const config = await prisma.config.findUnique({
    where: { id: configId },
    include: {
      partitions: { orderBy: { position: 'asc' } },
      osEntries: { orderBy: { position: 'asc' } },
    },
  });

  if (!config) {
    throw new Error('Configuration not found');
  }

  const lines = [];
  const ls = config.linboSettings || {};

  // [LINBO] section - exact order from production
  lines.push('[LINBO]');
  lines.push(`Server = ${getLinboSetting(ls, 'Server') || process.env.LINBO_SERVER || '10.0.0.1'}`);
  lines.push(`Group = ${getLinboSetting(ls, 'Group') || config.name}`);
  lines.push(`Cache = ${getLinboSetting(ls, 'Cache') || '/dev/sda4'}`);
  lines.push(`RootTimeout = ${getLinboSetting(ls, 'RootTimeout') || 600}`);
  lines.push(`AutoPartition = ${toYesNo(getLinboSetting(ls, 'AutoPartition') || false)}`);
  lines.push(`AutoFormat = ${toYesNo(getLinboSetting(ls, 'AutoFormat') || false)}`);
  lines.push(`AutoInitCache = ${toYesNo(getLinboSetting(ls, 'AutoInitCache') || false)}`);
  lines.push(`DownloadType = ${getLinboSetting(ls, 'DownloadType') || 'torrent'}`);
  // GuiDisabled and UseMinimalLayout — only emit if explicitly true
  const guiDisabled = getLinboSetting(ls, 'GuiDisabled');
  if (guiDisabled === true || guiDisabled === 'yes') {
    lines.push(`GuiDisabled = yes`);
  }
  const useMinimalLayout = getLinboSetting(ls, 'UseMinimalLayout');
  if (useMinimalLayout === true || useMinimalLayout === 'yes') {
    lines.push(`UseMinimalLayout = yes`);
  }
  lines.push(`BackgroundFontColor = ${getLinboSetting(ls, 'BackgroundFontColor') || 'white'}`);
  lines.push(`ConsoleFontColorStdout = ${getLinboSetting(ls, 'ConsoleFontColorStdout') || 'lightgreen'}`);
  lines.push(`ConsoleFontColorStderr = ${getLinboSetting(ls, 'ConsoleFontColorStderr') || 'orange'}`);
  lines.push(`SystemType = ${getLinboSetting(ls, 'SystemType') || 'bios64'}`);
  lines.push(`KernelOptions = ${getLinboSetting(ls, 'KernelOptions') || ''}`);
  lines.push(`clientDetailsVisibleByDefault = ${toYesNo(getLinboSetting(ls, 'clientDetailsVisibleByDefault') ?? true)}`);
  lines.push(`Locale = ${getLinboSetting(ls, 'Locale') || 'de-DE'}`);
  const bootTimeout = getLinboSetting(ls, 'BootTimeout');
  if (bootTimeout !== undefined && bootTimeout !== null) {
    lines.push(`BootTimeout = ${bootTimeout}`);
  }
  lines.push('');

  // [Partition] sections
  for (const p of config.partitions) {
    lines.push('[Partition]');
    lines.push(`Dev = ${p.device}`);
    lines.push(`Label = ${p.label || ''}`);
    lines.push(`Size = ${p.size || ''}`);
    lines.push(`Id = ${toHexId(p.partitionId)}`);
    lines.push(`FSType = ${p.fsType || ''}`);
    lines.push(`Bootable = ${toYesNo(p.bootable)}`);
    lines.push('');
  }

  // [OS] sections - exact order from production
  for (const os of config.osEntries) {
    lines.push('[OS]');
    lines.push(`Name = ${os.name}`);
    lines.push(`Version = ${os.version || ''}`);
    lines.push(`Description = ${os.description || ''}`);
    lines.push(`IconName = ${os.iconName || ''}`);
    lines.push(`Image = ${os.image || ''}`);
    lines.push(`BaseImage = ${os.baseImage || ''}`);
    lines.push(`Boot = ${os.rootDevice || ''}`);
    lines.push(`Root = ${os.root || os.rootDevice || ''}`);
    // Windows kernel fallback: if OS name matches Windows pattern and kernel is empty, set 'auto'
    const isWindows = /windows/i.test(os.name) || os.osType === 'windows';
    lines.push(`Kernel = ${os.kernel || (isWindows ? 'auto' : '')}`);
    lines.push(`Initrd = ${os.initrd || ''}`);
    lines.push(`Append = ${os.append ? (Array.isArray(os.append) ? os.append.join(' ') : os.append) : ''}`);
    lines.push(`StartEnabled = ${toYesNo(os.startEnabled)}`);
    lines.push(`SyncEnabled = ${toYesNo(os.syncEnabled)}`);
    lines.push(`NewEnabled = ${toYesNo(os.newEnabled)}`);
    lines.push(`Autostart = ${toYesNo(os.autostart)}`);
    lines.push(`AutostartTimeout = ${os.autostartTimeout || 0}`);
    lines.push(`DefaultAction = ${os.defaultAction || 'sync'}`);
    lines.push(`RestoreOpsiState = ${toYesNo(os.restoreOpsiState || false)}`);
    lines.push(`ForceOpsiSetup = ${os.forceOpsiSetup || ''}`);
    lines.push(`Hidden = ${toYesNo(os.hidden || false)}`);
    lines.push('');
  }

  return { content: lines.join('\n'), config };
}

/**
 * Deploy config as start.conf file to /srv/linbo/
 * @param {string} configId - Config UUID
 * @returns {Promise<{filepath: string, hash: string, size: number}>}
 */
async function deployConfig(configId) {
  const { content, config } = await generateStartConf(configId);
  const filename = `start.conf.${config.name}`;
  const filepath = path.join(LINBO_DIR, filename);

  // Ensure LINBO directory exists
  await fs.mkdir(LINBO_DIR, { recursive: true });

  // Backup existing file if different
  try {
    const existing = await fs.readFile(filepath, 'utf8');
    if (existing !== content) {
      const backupPath = `${filepath}.bak`;
      await fs.writeFile(backupPath, existing);
      console.log(`[ConfigService] Backup created: ${backupPath}`);
    }
  } catch (e) {
    // File doesn't exist, no backup needed
  }

  // Write new config
  await fs.writeFile(filepath, content, 'utf8');
  console.log(`[ConfigService] Config deployed: ${filepath}`);

  // Generate MD5 hash
  const hash = crypto.createHash('md5').update(content).digest('hex');
  await fs.writeFile(`${filepath}.md5`, hash);

  return { filepath, hash, size: content.length };
}

/**
 * Create IP-based symlinks for all hosts in a config's groups
 * LINBO uses IP-based symlinks: start.conf-10.0.0.111 -> start.conf.win11_efi_sata
 * @param {string} configId - Config UUID
 * @returns {Promise<number>} Number of symlinks created
 */
async function createHostSymlinks(configId) {
  const config = await prisma.config.findUnique({
    where: { id: configId },
    include: {
      hosts: true,
    },
  });

  if (!config) {
    throw new Error('Configuration not found');
  }

  const groupFile = `start.conf.${config.name}`;
  let created = 0;

  // Collect all hosts assigned to this config
  const allHosts = new Map();

  // Hosts directly assigned to this config
  for (const host of config.hosts) {
    if (host.ipAddress) {
      allHosts.set(host.ipAddress, host);
    }
  }

  // Create IP-based symlinks
  for (const [ipAddress, host] of allHosts) {
    const ipLink = path.join(LINBO_DIR, `start.conf-${ipAddress}`);

    try {
      // Remove existing symlink
      await fs.unlink(ipLink);
    } catch (e) {
      // Link doesn't exist
    }

    // Create new symlink (relative path)
    await fs.symlink(groupFile, ipLink);
    console.log(`[ConfigService] Symlink created: ${ipLink} -> ${groupFile}`);
    created++;
  }

  return created;
}

/**
 * Remove orphaned symlinks for hosts not in any config
 * @returns {Promise<number>} Number of symlinks removed
 */
async function cleanupOrphanedSymlinks() {
  const files = await fs.readdir(LINBO_DIR);
  let removed = 0;

  // Get all active host IPs
  const hosts = await prisma.host.findMany({
    select: { ipAddress: true },
    where: { ipAddress: { not: null } },
  });
  const activeIPs = new Set(hosts.map(h => h.ipAddress));

  for (const file of files) {
    // Match IP-based symlinks (start.conf-X.X.X.X)
    const match = file.match(/^start\.conf-(\d+\.\d+\.\d+\.\d+)$/);
    if (match) {
      const ip = match[1];
      if (!activeIPs.has(ip)) {
        const filepath = path.join(LINBO_DIR, file);
        try {
          await fs.unlink(filepath);
          console.log(`[ConfigService] Orphaned symlink removed: ${filepath}`);
          removed++;
        } catch (e) {
          console.error(`[ConfigService] Failed to remove: ${filepath}`, e.message);
        }
      }
    }
  }

  return removed;
}

/**
 * Deploy all active configs
 * @returns {Promise<{deployed: number, symlinks: number}>}
 */
async function deployAllConfigs() {
  const configs = await prisma.config.findMany({
    where: { status: 'active' },
  });

  let deployed = 0;
  let symlinks = 0;

  for (const config of configs) {
    try {
      await deployConfig(config.id);
      deployed++;
      symlinks += await createHostSymlinks(config.id);
    } catch (error) {
      console.error(`[ConfigService] Failed to deploy ${config.name}:`, error.message);
    }
  }

  return { deployed, symlinks };
}

/**
 * List deployed configs in /srv/linbo/
 * @returns {Promise<Array<{filename: string, hash: string, size: number, modifiedAt: Date}>>}
 */
async function listDeployedConfigs() {
  const files = await fs.readdir(LINBO_DIR);
  const configs = [];

  for (const file of files) {
    if (file.startsWith('start.conf.') && !file.endsWith('.md5') && !file.endsWith('.bak')) {
      const filepath = path.join(LINBO_DIR, file);
      try {
        const stat = await fs.stat(filepath);
        if (!stat.isSymbolicLink()) {
          let hash = null;
          try {
            hash = await fs.readFile(`${filepath}.md5`, 'utf8');
          } catch (e) {
            // MD5 file doesn't exist
          }

          configs.push({
            filename: file,
            groupName: file.replace('start.conf.', ''),
            hash: hash?.trim(),
            size: stat.size,
            modifiedAt: stat.mtime,
          });
        }
      } catch (e) {
        // Skip invalid files
      }
    }
  }

  return configs;
}

/**
 * Get raw start.conf content from deployed file
 * @param {string} configName - Config name (group name)
 * @returns {Promise<{content: string, filepath: string, exists: boolean, lastModified: Date|null}>}
 */
async function getRawConfig(configName) {
  const filename = `start.conf.${configName}`;
  const filepath = path.join(LINBO_DIR, filename);

  try {
    const content = await fs.readFile(filepath, 'utf8');
    const stat = await fs.stat(filepath);

    return {
      content,
      filepath,
      exists: true,
      lastModified: stat.mtime,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        content: '',
        filepath,
        exists: false,
        lastModified: null,
      };
    }
    throw error;
  }
}

/**
 * Parse start.conf content into structured data
 * @param {string} content - Raw start.conf content
 * @returns {{linboSettings: object, partitions: array, osEntries: array}}
 */
function parseStartConf(content) {
  const lines = content.split('\n');
  const result = {
    linboSettings: {},
    partitions: [],
    osEntries: [],
  };

  let currentSection = null;
  let currentData = {};

  const booleanFields = [
    'autopartition', 'autoformat', 'autoinitcache', 'guidisabled',
    'useminimallayout', 'clientdetailsvisiblebydefault', 'bootable',
    'startenabled', 'syncenabled', 'newenabled', 'autostart',
    'hidden', 'restoreopisstate'
  ];

  const integerFields = [
    'roottimeout', 'autostarttimeout', 'position', 'boottimeout'
  ];

  function saveCurrentSection() {
    if (!currentSection) return;

    if (currentSection === 'linbo') {
      result.linboSettings = { ...currentData };
    } else if (currentSection === 'partition') {
      // Parse partition ID — store as canonical hex string (lowercase, no 0x)
      let partId = null;
      if (currentData.id) {
        const idStr = String(currentData.id).trim();
        const stripped = idStr.replace(/^0x/i, '').toLowerCase();
        if (/^[0-9a-f]+$/.test(stripped)) {
          partId = stripped;
        }
      }

      result.partitions.push({
        device: currentData.dev || '',
        label: currentData.label || '',
        size: currentData.size || '',
        partitionId: partId,
        fsType: currentData.fstype || '',
        bootable: currentData.bootable || false,
        position: result.partitions.length,
      });
    } else if (currentSection === 'os') {
      // Convert append string to array (split by spaces, filter empty)
      let appendArray = [];
      if (currentData.append) {
        appendArray = currentData.append.split(/\s+/).filter(s => s.length > 0);
      }

      result.osEntries.push({
        name: currentData.name || 'Unknown OS',
        version: currentData.version || '',
        description: currentData.description || '',
        iconName: currentData.iconname || '',
        image: currentData.image || '',
        baseImage: currentData.baseimage || '',
        differentialImage: currentData.diffimage || '',
        rootDevice: currentData.boot || '',
        root: currentData.root || '',
        kernel: currentData.kernel || '',
        initrd: currentData.initrd || '',
        append: appendArray,
        startEnabled: currentData.startenabled !== false,
        syncEnabled: currentData.syncenabled !== false,
        newEnabled: currentData.newenabled !== false,
        autostart: currentData.autostart || false,
        autostartTimeout: currentData.autostarttimeout || 0,
        defaultAction: currentData.defaultaction || 'sync',
        restoreOpsiState: currentData.restoreopisstate || false,
        forceOpsiSetup: currentData.forceopisetup || '',
        hidden: currentData.hidden || false,
        position: result.osEntries.length,
      });
    }

    currentData = {};
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check for section header
    const sectionMatch = trimmed.match(/^\[(\w+)\]$/i);
    if (sectionMatch) {
      saveCurrentSection();
      currentSection = sectionMatch[1].toLowerCase();
      continue;
    }

    // Parse key = value
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.*)$/);
    if (kvMatch && currentSection) {
      const key = kvMatch[1].toLowerCase();
      let value = kvMatch[2].trim();

      // Convert boolean values
      if (booleanFields.includes(key)) {
        value = value.toLowerCase() === 'yes' || value === 'true' || value === '1';
      }
      // Convert integer values
      else if (integerFields.includes(key)) {
        value = parseInt(value, 10) || 0;
      }

      currentData[key] = value;
    }
  }

  // Save last section
  saveCurrentSection();

  return result;
}

/**
 * Save raw start.conf content and sync to database
 * @param {string} configName - Config name (group name)
 * @param {string} content - Raw config content
 * @param {string} configId - Config UUID for database sync
 * @returns {Promise<{filepath: string, size: number, hash: string, dbSynced: boolean}>}
 */
async function saveRawConfig(configName, content, configId = null) {
  const filename = `start.conf.${configName}`;
  const filepath = path.join(LINBO_DIR, filename);

  // Ensure LINBO directory exists
  await fs.mkdir(LINBO_DIR, { recursive: true });

  // Backup existing file if it exists
  try {
    const existing = await fs.readFile(filepath, 'utf8');
    if (existing !== content) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${filepath}.${timestamp}.bak`;
      await fs.writeFile(backupPath, existing);
      console.log(`[ConfigService] Backup created: ${backupPath}`);
    }
  } catch (e) {
    // File doesn't exist, no backup needed
  }

  // Write new content
  await fs.writeFile(filepath, content, 'utf8');
  console.log(`[ConfigService] Raw config saved: ${filepath}`);

  // Generate MD5 hash
  const hash = crypto.createHash('md5').update(content).digest('hex');
  await fs.writeFile(`${filepath}.md5`, hash);

  // Sync to database if configId provided
  let dbSynced = false;
  if (configId) {
    try {
      const parsed = parseStartConf(content);
      console.log('[ConfigService] Parsed linboSettings:', JSON.stringify(parsed.linboSettings, null, 2));

      // Update config with parsed data in a transaction
      await prisma.$transaction(async (tx) => {
        // Update linboSettings - REPLACE entire JSON, not merge
        const updateResult = await tx.config.update({
          where: { id: configId },
          data: {
            linboSettings: parsed.linboSettings,
          },
        });
        console.log('[ConfigService] DB updated, linboSettings:', JSON.stringify(updateResult.linboSettings, null, 2));

        // Delete existing partitions and recreate
        await tx.configPartition.deleteMany({
          where: { configId },
        });

        for (const partition of parsed.partitions) {
          await tx.configPartition.create({
            data: {
              ...partition,
              config: { connect: { id: configId } },
            },
          });
        }

        // Delete existing OS entries and recreate
        await tx.configOs.deleteMany({
          where: { configId },
        });

        for (const os of parsed.osEntries) {
          await tx.configOs.create({
            data: {
              ...os,
              config: { connect: { id: configId } },
            },
          });
        }
      });

      console.log(`[ConfigService] Database synced for config: ${configName}`);
      dbSynced = true;
    } catch (error) {
      console.error(`[ConfigService] Failed to sync database:`, error.message);
      // Don't throw - file save was successful, DB sync is secondary
    }
  }

  return { filepath, size: content.length, hash, dbSynced };
}

module.exports = {
  generateStartConf,
  parseStartConf,
  deployConfig,
  createHostSymlinks,
  cleanupOrphanedSymlinks,
  deployAllConfigs,
  listDeployedConfigs,
  getRawConfig,
  saveRawConfig,
};
