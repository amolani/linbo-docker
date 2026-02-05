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
 * Generate start.conf content from database config
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

  // Header comment
  lines.push(`# LINBO start.conf - ${config.name}`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push(`# Version: ${config.version}`);
  lines.push('');

  // [LINBO] section
  lines.push('[LINBO]');
  const linboSettings = config.linboSettings || {};
  const defaultSettings = {
    Cache: '/dev/sda4',
    Server: process.env.LINBO_SERVER || '10.0.0.1',
    Group: config.name,
    RootTimeout: 600,
    AutoPartition: 'no',
    AutoFormat: 'no',
    AutoInitCache: 'no',
    Autostart: 'no',
    DownloadType: 'torrent',
    GuiDisabled: 'no',
    UseMinimalLayout: 'no',
    Locale: 'de-de',
    SystemType: 'bios64',
    KernelOptions: '',
  };

  for (const [key, defaultValue] of Object.entries(defaultSettings)) {
    const rawValue = getLinboSetting(linboSettings, key);
    let value = rawValue !== undefined ? rawValue : defaultValue;
    // Convert boolean to yes/no for start.conf format
    if (typeof value === 'boolean') {
      value = value ? 'yes' : 'no';
    }
    lines.push(`${key} = ${value}`);
  }
  lines.push('');

  // [Partition] sections
  for (const partition of config.partitions) {
    lines.push('[Partition]');
    lines.push(`Dev = ${partition.device}`);
    if (partition.label) lines.push(`Label = ${partition.label}`);
    if (partition.size) lines.push(`Size = ${partition.size}`);
    if (partition.partitionId) lines.push(`Id = ${partition.partitionId}`);
    if (partition.fsType) lines.push(`FSType = ${partition.fsType}`);
    lines.push(`Bootable = ${partition.bootable ? 'yes' : 'no'}`);
    lines.push('');
  }

  // [OS] sections
  for (const os of config.osEntries) {
    lines.push('[OS]');
    lines.push(`Name = ${os.name}`);
    if (os.description) lines.push(`Description = ${os.description}`);
    if (os.iconName) lines.push(`IconName = ${os.iconName}`);
    if (os.baseImage) lines.push(`BaseImage = ${os.baseImage}`);
    if (os.differentialImage) lines.push(`DiffImage = ${os.differentialImage}`);
    if (os.rootDevice) lines.push(`Boot = ${os.rootDevice}`);
    if (os.kernel) lines.push(`Kernel = ${os.kernel}`);
    if (os.initrd) lines.push(`Initrd = ${os.initrd}`);
    if (os.append && os.append.length > 0) {
      lines.push(`Append = ${os.append.join(' ')}`);
    }
    lines.push(`StartEnabled = ${os.startEnabled ? 'yes' : 'no'}`);
    lines.push(`SyncEnabled = ${os.syncEnabled ? 'yes' : 'no'}`);
    lines.push(`NewEnabled = ${os.newEnabled ? 'yes' : 'no'}`);
    if (os.autostart) {
      lines.push('Autostart = yes');
      if (os.autostartTimeout > 0) {
        lines.push(`AutostartTimeout = ${os.autostartTimeout}`);
      }
    }
    if (os.defaultAction) lines.push(`DefaultAction = ${os.defaultAction}`);
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
      hostGroups: {
        include: {
          hosts: true,
        },
      },
    },
  });

  if (!config) {
    throw new Error('Configuration not found');
  }

  const groupFile = `start.conf.${config.name}`;
  let created = 0;

  // Collect all hosts (directly assigned and from groups)
  const allHosts = new Map();

  // Hosts directly assigned to this config
  for (const host of config.hosts) {
    if (host.ipAddress) {
      allHosts.set(host.ipAddress, host);
    }
  }

  // Hosts from groups using this config as default
  for (const group of config.hostGroups) {
    for (const host of group.hosts) {
      if (host.ipAddress) {
        allHosts.set(host.ipAddress, host);
      }
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
    'useminimallayout', 'bootable', 'startenabled', 'syncenabled',
    'newenabled', 'autostart', 'hidden', 'restoreopisstate', 'forceopisetup'
  ];

  const integerFields = [
    'roottimeout', 'autostarttimeout', 'position'
  ];

  function saveCurrentSection() {
    if (!currentSection) return;

    if (currentSection === 'linbo') {
      result.linboSettings = { ...currentData };
    } else if (currentSection === 'partition') {
      // Parse partition ID - can be hex (0x83, ef) or decimal
      let partId = null;
      if (currentData.id) {
        const idStr = String(currentData.id).toLowerCase().trim();
        if (idStr.startsWith('0x')) {
          partId = parseInt(idStr, 16);
        } else if (/^[0-9a-f]+$/i.test(idStr)) {
          // Could be hex without 0x prefix (like "ef", "83")
          partId = parseInt(idStr, 16);
        } else {
          partId = parseInt(idStr, 10);
        }
        if (isNaN(partId)) partId = null;
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
      // Build description with version if present
      let desc = currentData.description || '';
      if (currentData.version && !desc.includes(currentData.version)) {
        desc = desc ? `${desc} (${currentData.version})` : currentData.version;
      }

      result.osEntries.push({
        name: currentData.name || 'Unknown OS',
        description: desc,
        iconName: currentData.iconname || '',
        baseImage: currentData.baseimage || currentData.image || '',
        differentialImage: currentData.diffimage || '',
        rootDevice: currentData.root || currentData.boot || '',
        kernel: currentData.kernel || '',
        initrd: currentData.initrd || '',
        append: currentData.append ? [currentData.append] : [],
        startEnabled: currentData.startenabled !== false,
        syncEnabled: currentData.syncenabled !== false,
        newEnabled: currentData.newenabled !== false,
        autostart: currentData.autostart || false,
        autostartTimeout: currentData.autostarttimeout || 5,
        defaultAction: currentData.defaultaction || 'sync',
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

      // Update config with parsed data in a transaction
      await prisma.$transaction(async (tx) => {
        // Update linboSettings
        await tx.config.update({
          where: { id: configId },
          data: {
            linboSettings: parsed.linboSettings,
          },
        });

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
