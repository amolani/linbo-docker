/**
 * LINBO Docker - GRUB Service
 * Generate GRUB configuration files for network boot
 *
 * This service generates production-like GRUB configs with:
 * - Template-based config generation
 * - OS menu entries with linbocmd support (Start, Linbo-Start, Sync+Start, Neu+Start)
 * - Host configs as symlinks to group configs
 * - Cache partition detection
 */

const fs = require('fs').promises;
const path = require('path');
const { prisma } = require('../lib/prisma');

const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const GRUB_DIR = path.join(LINBO_DIR, 'boot/grub');
const HOSTCFG_DIR = path.join(GRUB_DIR, 'hostcfg');
const TEMPLATES_DIR = path.join(__dirname, '../templates/grub');

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Case-insensitive lookup for linboSettings
 * Frontend uses lowercase, backend expects PascalCase
 */
function getLinboSetting(settings, key) {
  if (!settings) return undefined;
  if (settings[key] !== undefined) return settings[key];
  const lowerKey = key.toLowerCase();
  if (settings[lowerKey] !== undefined) return settings[lowerKey];
  for (const k of Object.keys(settings)) {
    if (k.toLowerCase() === lowerKey) return settings[k];
  }
  return undefined;
}

/**
 * Convert Linux device path to GRUB partition format
 * Examples:
 *   /dev/sda1 → (hd0,1)
 *   /dev/sdb3 → (hd1,3)
 *   /dev/nvme0n1p2 → (hd0,2)
 *   /dev/mmcblk0p1 → (hd0,1)
 *   /dev/vda1 → (hd0,1)
 *
 * @param {string} device - Linux device path (e.g., /dev/sda1)
 * @returns {string} GRUB partition format (e.g., (hd0,1))
 */
function getGrubPart(device) {
  if (!device) return '(hd0,1)';

  // Remove /dev/ prefix
  const dev = device.replace('/dev/', '');

  // NVMe: nvme0n1p2 → disk 0, partition 2
  const nvmeMatch = dev.match(/^nvme(\d+)n\d+p(\d+)$/);
  if (nvmeMatch) {
    return `(hd${nvmeMatch[1]},${nvmeMatch[2]})`;
  }

  // eMMC: mmcblk0p1 → disk 0, partition 1
  const mmcMatch = dev.match(/^mmcblk(\d+)p(\d+)$/);
  if (mmcMatch) {
    return `(hd${mmcMatch[1]},${mmcMatch[2]})`;
  }

  // SATA/SCSI/virtio: sda1, vda1, hda1 → disk 0, partition 1
  const sdMatch = dev.match(/^([shv]d)([a-z])(\d+)$/);
  if (sdMatch) {
    const diskNum = sdMatch[2].charCodeAt(0) - 'a'.charCodeAt(0);
    return `(hd${diskNum},${sdMatch[3]})`;
  }

  // Fallback
  return '(hd0,1)';
}

/**
 * Get GRUB OS type from OS name for menu icon classes
 * Examples:
 *   "Windows 11 Pro" → "win11"
 *   "Windows 10 Education" → "win10"
 *   "Ubuntu 22.04" → "ubuntu"
 *   "Debian 12" → "debian"
 *   "Linux Mint" → "linuxmint"
 *
 * @param {string} osname - OS name from config
 * @returns {string} GRUB OS type for class attribute
 */
function getGrubOstype(osname) {
  if (!osname) return 'unknown';

  const name = osname.toLowerCase();

  // Windows variants
  if (name.includes('windows 11') || name.includes('win11')) return 'win11';
  if (name.includes('windows 10') || name.includes('win10')) return 'win10';
  if (name.includes('windows 8') || name.includes('win8')) return 'win8';
  if (name.includes('windows 7') || name.includes('win7')) return 'win7';
  if (name.includes('windows')) return 'windows';

  // Linux distributions
  if (name.includes('ubuntu')) return 'ubuntu';
  if (name.includes('debian')) return 'debian';
  if (name.includes('mint')) return 'linuxmint';
  if (name.includes('fedora')) return 'fedora';
  if (name.includes('opensuse') || name.includes('suse')) return 'opensuse';
  if (name.includes('arch')) return 'arch';
  if (name.includes('manjaro')) return 'manjaro';
  if (name.includes('centos')) return 'centos';
  if (name.includes('rhel') || name.includes('red hat')) return 'rhel';

  // Generic Linux
  if (name.includes('linux')) return 'linux';

  return 'unknown';
}

/**
 * Find cache partition from partition list
 * Cache partition is identified by label "cache" or fstype ext4/btrfs with no OS
 *
 * @param {Array} partitions - Array of partition objects
 * @returns {Object|null} Cache partition object or null
 */
function findCachePartition(partitions) {
  if (!partitions || !Array.isArray(partitions)) return null;

  // First, look for partition with label "cache"
  const byLabel = partitions.find(p =>
    p.label && p.label.toLowerCase() === 'cache'
  );
  if (byLabel) return byLabel;

  // Then look for ext4/btrfs partition that's not a boot/efi partition
  const byFstype = partitions.find(p =>
    (p.fstype === 'ext4' || p.fstype === 'btrfs') &&
    p.id !== 'ef00' && // Not EFI
    p.id !== '0c01' && // Not MS reserved
    !p.label?.toLowerCase().includes('windows') &&
    !p.label?.toLowerCase().includes('efi')
  );

  return byFstype || null;
}

/**
 * Get partition number from device path
 * Examples:
 *   /dev/sda1 → 1
 *   /dev/nvme0n1p3 → 3
 *   /dev/mmcblk0p2 → 2
 *
 * @param {string} device - Device path
 * @returns {number} Partition number
 */
function getPartitionNumber(device) {
  if (!device) return 1;

  // NVMe/eMMC: extract after 'p'
  const pMatch = device.match(/p(\d+)$/);
  if (pMatch) return parseInt(pMatch[1], 10);

  // SATA/SCSI: extract trailing number
  const numMatch = device.match(/(\d+)$/);
  if (numMatch) return parseInt(numMatch[1], 10);

  return 1;
}

/**
 * Find the partition index for an OS's root device
 *
 * @param {Array} partitions - Array of partition objects
 * @param {string} rootDevice - Root device path (e.g., /dev/sda2)
 * @returns {number} Partition index (1-based, for GRUB linbocmd)
 */
function getOsPartitionIndex(partitions, rootDevice) {
  if (!partitions || !Array.isArray(partitions) || !rootDevice) return 1;

  const index = partitions.findIndex(p => p.dev === rootDevice);
  return index >= 0 ? index + 1 : 1;
}

/**
 * Load a GRUB template file
 *
 * @param {string} templateName - Template filename (e.g., 'grub.cfg.global')
 * @returns {Promise<string>} Template content
 */
async function loadTemplate(templateName) {
  const filepath = path.join(TEMPLATES_DIR, templateName);
  return fs.readFile(filepath, 'utf8');
}

/**
 * Apply template replacements
 * Replaces @@placeholder@@ with values from replacements object
 *
 * @param {string} template - Template string
 * @param {Object} replacements - Key-value pairs for replacement
 * @returns {string} Processed template
 */
function applyTemplate(template, replacements) {
  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    const placeholder = `@@${key}@@`;
    result = result.split(placeholder).join(value ?? '');
  }
  return result;
}

/**
 * Get OS label from partition list
 *
 * @param {Array} partitions - Partition list
 * @param {string} rootDevice - Root device path
 * @returns {string} Partition label or empty string
 */
function getOsLabel(partitions, rootDevice) {
  if (!partitions || !rootDevice) return '';
  const partition = partitions.find(p => p.dev === rootDevice);
  return partition?.label || '';
}

// =============================================================================
// Config Generation Functions
// =============================================================================

/**
 * Generate GRUB config for a host group
 * Creates: /boot/grub/{groupname}.cfg
 *
 * @param {string} groupName - Name of the host group
 * @param {object} options - Additional options
 * @returns {Promise<{filepath: string, content: string}>}
 */
async function generateGroupGrubConfig(groupName, options = {}) {
  // Get group config with partitions and OS entries
  const group = await prisma.hostGroup.findFirst({
    where: { name: groupName },
    include: {
      defaultConfig: {
        include: {
          partitions: { orderBy: { position: 'asc' } },
          osEntries: { orderBy: { position: 'asc' } },
        },
      },
    },
  });

  const config = group?.defaultConfig;
  const partitions = config?.partitions || [];
  const osEntries = config?.osEntries || [];

  // Get kernel options (case-insensitive lookup)
  let kernelOptions = options.kernelOptions || 'quiet splash';
  const configKernelOpts = getLinboSetting(config?.linboSettings, 'KernelOptions');
  if (configKernelOpts) {
    kernelOptions = configKernelOpts;
  }

  // Get server address
  const server = getLinboSetting(config?.linboSettings, 'Server') || '$pxe_default_server';

  // Build kernel options string
  const kopts = `${kernelOptions} server=${server}`.trim();

  // Find cache partition
  const cachePartition = findCachePartition(partitions);
  const cacheLabel = cachePartition?.label || '';
  const cacheRoot = cachePartition ? getGrubPart(cachePartition.dev) : '(hd0,2)';

  // Load and process global template
  const globalTemplate = await loadTemplate('grub.cfg.global');
  let content = applyTemplate(globalTemplate, {
    group: groupName,
    timestamp: new Date().toISOString(),
    cachelabel: cacheLabel,
    cacheroot: cacheRoot,
    kopts: kopts,
  });

  // Load OS template
  const osTemplate = await loadTemplate('grub.cfg.os');

  // Generate menu entries for each OS
  for (let i = 0; i < osEntries.length; i++) {
    const os = osEntries[i];
    const osnr = i + 1; // 1-based index for linbocmd
    const osLabel = getOsLabel(partitions, os.root);
    const osRoot = getGrubPart(os.root);
    const partnr = getOsPartitionIndex(partitions, os.root);

    const osContent = applyTemplate(osTemplate, {
      group: groupName,
      osname: os.name || `OS ${osnr}`,
      ostype: getGrubOstype(os.name),
      oslabel: osLabel,
      osroot: osRoot,
      kernel: os.kernel || '/boot/vmlinuz',
      initrd: os.initrd || '/boot/initrd.img',
      append: os.append || '',
      osnr: String(osnr),
      partnr: String(partnr),
      kopts: kopts,
    });

    content += osContent;
  }

  // Ensure GRUB directory exists
  await fs.mkdir(GRUB_DIR, { recursive: true });

  const filepath = path.join(GRUB_DIR, `${groupName}.cfg`);
  await fs.writeFile(filepath, content, 'utf8');

  console.log(`[GrubService] Generated group config: ${filepath}`);

  return { filepath, content };
}

/**
 * Generate GRUB config symlink for a specific host
 * Creates: /boot/grub/hostcfg/{hostname}.cfg -> ../{groupname}.cfg
 *
 * @param {string} hostname - Hostname
 * @param {string} groupName - Group name for this host
 * @param {object} options - Additional options
 * @returns {Promise<{filepath: string, target: string, isSymlink: boolean}>}
 */
async function generateHostGrubConfig(hostname, groupName, options = {}) {
  // Ensure host config directory exists
  await fs.mkdir(HOSTCFG_DIR, { recursive: true });

  const filepath = path.join(HOSTCFG_DIR, `${hostname}.cfg`);
  const target = `../${groupName}.cfg`;

  // Remove existing file/symlink if exists
  try {
    await fs.unlink(filepath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  // Create symlink
  await fs.symlink(target, filepath);

  console.log(`[GrubService] Created host symlink: ${filepath} -> ${target}`);

  return { filepath, target, isSymlink: true };
}

/**
 * Generate main grub.cfg that chains to group/host configs
 * Creates: /boot/grub/grub.cfg
 *
 * @returns {Promise<{filepath: string, content: string}>}
 */
async function generateMainGrubConfig() {
  const template = await loadTemplate('grub.cfg.pxe');
  const content = applyTemplate(template, {
    timestamp: new Date().toISOString(),
  });

  await fs.mkdir(GRUB_DIR, { recursive: true });

  const filepath = path.join(GRUB_DIR, 'grub.cfg');
  await fs.writeFile(filepath, content, 'utf8');

  console.log(`[GrubService] Generated main grub.cfg: ${filepath}`);

  return { filepath, content };
}

/**
 * Regenerate all GRUB configs for all groups and hosts
 * @returns {Promise<{groups: number, hosts: number, configs: Array}>}
 */
async function regenerateAllGrubConfigs() {
  const results = [];
  let groupCount = 0;
  let hostCount = 0;

  // Generate main grub.cfg
  await generateMainGrubConfig();
  results.push({ type: 'main', name: 'grub.cfg' });

  // Get all groups with their hosts
  const groups = await prisma.hostGroup.findMany({
    include: {
      hosts: true,
      defaultConfig: {
        include: {
          partitions: { orderBy: { position: 'asc' } },
          osEntries: { orderBy: { position: 'asc' } },
        },
      },
    },
  });

  for (const group of groups) {
    try {
      // Generate group config
      await generateGroupGrubConfig(group.name);
      results.push({ type: 'group', name: group.name });
      groupCount++;

      // Generate host symlinks for each host in the group
      for (const host of group.hosts) {
        try {
          await generateHostGrubConfig(host.hostname, group.name);
          results.push({ type: 'host', name: host.hostname, group: group.name, isSymlink: true });
          hostCount++;
        } catch (error) {
          console.error(`[GrubService] Failed to generate config for host ${host.hostname}:`, error.message);
          results.push({ type: 'host', name: host.hostname, error: error.message });
        }
      }
    } catch (error) {
      console.error(`[GrubService] Failed to generate config for group ${group.name}:`, error.message);
      results.push({ type: 'group', name: group.name, error: error.message });
    }
  }

  // Also handle hosts without a group (orphaned hosts)
  const orphanedHosts = await prisma.host.findMany({
    where: { groupId: null },
  });

  for (const host of orphanedHosts) {
    try {
      await generateHostGrubConfig(host.hostname, 'default');
      results.push({ type: 'host', name: host.hostname, group: 'default', isSymlink: true });
      hostCount++;
    } catch (error) {
      console.error(`[GrubService] Failed to generate config for orphaned host ${host.hostname}:`, error.message);
      results.push({ type: 'host', name: host.hostname, error: error.message });
    }
  }

  console.log(`[GrubService] Regenerated ${groupCount} group configs and ${hostCount} host symlinks`);

  return {
    groups: groupCount,
    hosts: hostCount,
    configs: results,
  };
}

/**
 * Migrate existing host config files to symlinks
 * Converts all regular files in hostcfg/ to symlinks pointing to group configs
 *
 * @returns {Promise<{migrated: number, skipped: number, errors: Array}>}
 */
async function migrateHostConfigsToSymlinks() {
  const results = {
    migrated: 0,
    skipped: 0,
    alreadySymlinks: 0,
    errors: [],
  };

  // Get all hosts with their groups
  const hosts = await prisma.host.findMany({
    include: {
      group: true,
    },
  });

  for (const host of hosts) {
    const filepath = path.join(HOSTCFG_DIR, `${host.hostname}.cfg`);
    const groupName = host.group?.name || 'default';
    const target = `../${groupName}.cfg`;

    try {
      // Check if file exists
      let stat;
      try {
        stat = await fs.lstat(filepath);
      } catch (error) {
        if (error.code === 'ENOENT') {
          // File doesn't exist, create symlink
          await fs.symlink(target, filepath);
          results.migrated++;
          continue;
        }
        throw error;
      }

      // Check if already a symlink
      if (stat.isSymbolicLink()) {
        const currentTarget = await fs.readlink(filepath);
        if (currentTarget === target) {
          results.alreadySymlinks++;
          continue;
        }
        // Different target, update symlink
        await fs.unlink(filepath);
        await fs.symlink(target, filepath);
        results.migrated++;
        continue;
      }

      // Regular file - backup and replace with symlink
      const backupPath = `${filepath}.bak.${Date.now()}`;
      await fs.rename(filepath, backupPath);
      await fs.symlink(target, filepath);
      results.migrated++;
      console.log(`[GrubService] Migrated ${host.hostname}.cfg (backup: ${backupPath})`);
    } catch (error) {
      results.errors.push({ hostname: host.hostname, error: error.message });
      console.error(`[GrubService] Failed to migrate ${host.hostname}:`, error.message);
    }
  }

  console.log(`[GrubService] Migration complete: ${results.migrated} migrated, ${results.alreadySymlinks} already symlinks, ${results.errors.length} errors`);

  return results;
}

/**
 * Delete GRUB config for a group
 * @param {string} groupName - Group name
 * @returns {Promise<boolean>}
 */
async function deleteGroupGrubConfig(groupName) {
  const filepath = path.join(GRUB_DIR, `${groupName}.cfg`);
  try {
    await fs.unlink(filepath);
    console.log(`[GrubService] Deleted group config: ${filepath}`);
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return false;
  }
}

/**
 * Delete GRUB config/symlink for a host
 * @param {string} hostname - Hostname
 * @returns {Promise<boolean>}
 */
async function deleteHostGrubConfig(hostname) {
  const filepath = path.join(HOSTCFG_DIR, `${hostname}.cfg`);
  try {
    await fs.unlink(filepath);
    console.log(`[GrubService] Deleted host config: ${filepath}`);
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return false;
  }
}

/**
 * List all GRUB configs
 * @returns {Promise<{groups: string[], hosts: Array<{name: string, isSymlink: boolean, target?: string}>}>}
 */
async function listGrubConfigs() {
  const groups = [];
  const hosts = [];

  // List group configs
  try {
    const files = await fs.readdir(GRUB_DIR);
    for (const file of files) {
      if (file.endsWith('.cfg') && file !== 'grub.cfg') {
        groups.push(file.replace('.cfg', ''));
      }
    }
  } catch (error) {
    // Directory doesn't exist
  }

  // List host configs with symlink info
  try {
    const files = await fs.readdir(HOSTCFG_DIR);
    for (const file of files) {
      if (file.endsWith('.cfg')) {
        const filepath = path.join(HOSTCFG_DIR, file);
        const name = file.replace('.cfg', '');

        try {
          const stat = await fs.lstat(filepath);
          if (stat.isSymbolicLink()) {
            const target = await fs.readlink(filepath);
            hosts.push({ name, isSymlink: true, target });
          } else {
            hosts.push({ name, isSymlink: false });
          }
        } catch (error) {
          hosts.push({ name, isSymlink: false, error: error.message });
        }
      }
    }
  } catch (error) {
    // Directory doesn't exist
  }

  return { groups, hosts };
}

/**
 * Cleanup orphaned GRUB configs
 * Removes configs for groups/hosts that no longer exist in the database
 * @returns {Promise<{removedGroups: string[], removedHosts: string[]}>}
 */
async function cleanupOrphanedConfigs() {
  const removedGroups = [];
  const removedHosts = [];

  // Get current groups and hosts from database
  const [dbGroups, dbHosts] = await Promise.all([
    prisma.hostGroup.findMany({ select: { name: true } }),
    prisma.host.findMany({ select: { hostname: true } }),
  ]);

  const validGroups = new Set(dbGroups.map(g => g.name));
  const validHosts = new Set(dbHosts.map(h => h.hostname));

  // List and check group configs
  try {
    const files = await fs.readdir(GRUB_DIR);
    for (const file of files) {
      if (file.endsWith('.cfg') && file !== 'grub.cfg') {
        const groupName = file.replace('.cfg', '');
        if (!validGroups.has(groupName)) {
          await deleteGroupGrubConfig(groupName);
          removedGroups.push(groupName);
        }
      }
    }
  } catch (error) {
    // Directory doesn't exist
  }

  // List and check host configs
  try {
    const files = await fs.readdir(HOSTCFG_DIR);
    for (const file of files) {
      if (file.endsWith('.cfg')) {
        const hostname = file.replace('.cfg', '');
        if (!validHosts.has(hostname)) {
          await deleteHostGrubConfig(hostname);
          removedHosts.push(hostname);
        }
      }
    }
  } catch (error) {
    // Directory doesn't exist
  }

  console.log(`[GrubService] Cleanup: removed ${removedGroups.length} group configs, ${removedHosts.length} host configs`);

  return { removedGroups, removedHosts };
}

module.exports = {
  // Helper functions (exported for testing)
  getGrubPart,
  getGrubOstype,
  findCachePartition,
  getPartitionNumber,
  getOsPartitionIndex,
  loadTemplate,
  applyTemplate,
  getOsLabel,
  getLinboSetting,

  // Main functions
  generateGroupGrubConfig,
  generateHostGrubConfig,
  generateMainGrubConfig,
  regenerateAllGrubConfigs,
  migrateHostConfigsToSymlinks,
  deleteGroupGrubConfig,
  deleteHostGrubConfig,
  listGrubConfigs,
  cleanupOrphanedConfigs,
};
