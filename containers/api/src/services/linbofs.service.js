/**
 * LINBO Docker - Linbofs Service
 * Manages linbofs64 updates and key injection
 */

const { exec, spawn } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const execAsync = util.promisify(exec);

const UPDATE_SCRIPT = process.env.UPDATE_LINBOFS_SCRIPT || '/usr/share/linuxmuster/linbo/update-linbofs.sh';
const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const CONFIG_DIR = process.env.CONFIG_DIR || '/etc/linuxmuster/linbo';

/**
 * Execute update-linbofs script to inject keys into linbofs64
 * @param {object} options - Optional configuration
 * @returns {Promise<{success: boolean, output: string, errors: string|null, duration: number}>}
 */
async function updateLinbofs(options = {}) {
  const startTime = Date.now();

  const env = {
    ...process.env,
    LINBO_DIR: options.linboDir || LINBO_DIR,
    CONFIG_DIR: options.configDir || CONFIG_DIR,
    RSYNC_SECRETS: options.rsyncSecrets || '/etc/rsyncd.secrets',
    ...(options.env || {}),
  };

  try {
    // Check if script exists
    try {
      await fs.access(UPDATE_SCRIPT, fs.constants.X_OK);
    } catch (e) {
      throw new Error(`Update script not found or not executable: ${UPDATE_SCRIPT}`);
    }

    const { stdout, stderr } = await execAsync(`bash ${UPDATE_SCRIPT}`, {
      env,
      timeout: 300000, // 5 minute timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    const duration = Date.now() - startTime;

    return {
      success: true,
      output: stdout,
      errors: stderr || null,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    return {
      success: false,
      output: error.stdout || '',
      errors: error.stderr || error.message,
      duration,
    };
  }
}

/**
 * Execute update-linbofs with real-time output streaming
 * @param {function} onData - Callback for stdout data
 * @param {function} onError - Callback for stderr data
 * @param {object} options - Optional configuration
 * @returns {Promise<{success: boolean, exitCode: number, duration: number}>}
 */
function updateLinbofsStream(onData, onError, options = {}) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const env = {
      ...process.env,
      LINBO_DIR: options.linboDir || LINBO_DIR,
      CONFIG_DIR: options.configDir || CONFIG_DIR,
      RSYNC_SECRETS: options.rsyncSecrets || '/etc/rsyncd.secrets',
      ...(options.env || {}),
    };

    const child = spawn('bash', [UPDATE_SCRIPT], { env });

    child.stdout.on('data', (data) => {
      if (onData) onData(data.toString());
    });

    child.stderr.on('data', (data) => {
      if (onError) onError(data.toString());
    });

    child.on('close', (code) => {
      const duration = Date.now() - startTime;
      resolve({
        success: code === 0,
        exitCode: code,
        duration,
      });
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Verify if linbofs64 contains required keys
 * @returns {Promise<{valid: boolean, hasAuthorizedKeys: boolean, hasDropbearKey: boolean, hasSshKey: boolean, hasPasswordHash: boolean}>}
 */
async function verifyLinbofs() {
  const linbofs = path.join(LINBO_DIR, 'linbofs64');

  try {
    // Check if linbofs64 exists
    await fs.access(linbofs);

    // List contents and check for required files
    const { stdout } = await execAsync(
      `xz -dc "${linbofs}" | cpio -t 2>/dev/null || true`
    );

    const contents = stdout.toLowerCase();

    return {
      valid: true,
      hasAuthorizedKeys: contents.includes('.ssh/authorized_keys'),
      hasDropbearKey: contents.includes('etc/dropbear'),
      hasSshKey: contents.includes('etc/ssh/ssh_host'),
      hasPasswordHash: contents.includes('etc/linbo_pwhash'),
    };
  } catch (error) {
    return {
      valid: false,
      hasAuthorizedKeys: false,
      hasDropbearKey: false,
      hasSshKey: false,
      hasPasswordHash: false,
      error: error.message,
    };
  }
}

/**
 * Get linbofs64 file information
 * @returns {Promise<{exists: boolean, size: number, md5: string|null, modifiedAt: Date|null}>}
 */
async function getLinbofsInfo() {
  const linbofs = path.join(LINBO_DIR, 'linbofs64');
  const linbofsMd5 = path.join(LINBO_DIR, 'linbofs64.md5');

  try {
    const stat = await fs.stat(linbofs);

    let md5 = null;
    try {
      md5 = (await fs.readFile(linbofsMd5, 'utf8')).trim();
    } catch (e) {
      // MD5 file doesn't exist
    }

    return {
      exists: true,
      path: linbofs,
      size: stat.size,
      md5,
      modifiedAt: stat.mtime,
    };
  } catch (error) {
    return {
      exists: false,
      path: linbofs,
      size: 0,
      md5: null,
      modifiedAt: null,
      error: error.message,
    };
  }
}

/**
 * Check if SSH keys exist in config directory
 * @returns {Promise<{dropbearKeys: string[], sshKeys: string[], publicKeys: string[]}>}
 */
async function checkKeyFiles() {
  const result = {
    dropbearKeys: [],
    sshKeys: [],
    publicKeys: [],
  };

  try {
    const files = await fs.readdir(CONFIG_DIR);

    for (const file of files) {
      if (file.startsWith('dropbear_') && file.endsWith('_host_key')) {
        result.dropbearKeys.push(file);
      } else if (file.startsWith('ssh_host_') && file.endsWith('_key')) {
        result.sshKeys.push(file);
      } else if (file.endsWith('.pub')) {
        result.publicKeys.push(file);
      }
    }
  } catch (error) {
    // Directory doesn't exist or isn't readable
  }

  // Also check /root/.ssh
  try {
    const sshFiles = await fs.readdir('/root/.ssh');
    for (const file of sshFiles) {
      if (file.startsWith('id_') && file.endsWith('.pub')) {
        result.publicKeys.push(`/root/.ssh/${file}`);
      }
    }
  } catch (error) {
    // /root/.ssh doesn't exist
  }

  return result;
}

/**
 * Generate SSH key pair if not exists
 * @param {string} type - Key type (rsa, ed25519)
 * @returns {Promise<{created: boolean, path: string}>}
 */
async function generateSshKeyPair(type = 'ed25519') {
  const keyPath = path.join(CONFIG_DIR, `ssh_host_${type}_key`);

  try {
    await fs.access(keyPath);
    return { created: false, path: keyPath, message: 'Key already exists' };
  } catch (e) {
    // Key doesn't exist, create it
  }

  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });

    const { stdout, stderr } = await execAsync(
      `ssh-keygen -t ${type} -f "${keyPath}" -N "" -q`
    );

    return {
      created: true,
      path: keyPath,
      output: stdout || stderr,
    };
  } catch (error) {
    throw new Error(`Failed to generate ${type} key: ${error.message}`);
  }
}

/**
 * Generate Dropbear key if not exists
 * @param {string} type - Key type (rsa, ecdsa, ed25519)
 * @returns {Promise<{created: boolean, path: string}>}
 */
async function generateDropbearKey(type = 'ed25519') {
  const keyPath = path.join(CONFIG_DIR, `dropbear_${type}_host_key`);

  try {
    await fs.access(keyPath);
    return { created: false, path: keyPath, message: 'Key already exists' };
  } catch (e) {
    // Key doesn't exist, create it
  }

  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });

    // Map type names for dropbearkey
    const dropbearType = type === 'ed25519' ? 'ed25519' : type === 'ecdsa' ? 'ecdsa' : 'rsa';

    const { stdout, stderr } = await execAsync(
      `dropbearkey -t ${dropbearType} -f "${keyPath}"`
    );

    return {
      created: true,
      path: keyPath,
      output: stdout || stderr,
    };
  } catch (error) {
    throw new Error(`Failed to generate dropbear ${type} key: ${error.message}`);
  }
}

/**
 * Initialize all required keys
 * @returns {Promise<{created: string[], existing: string[]}>}
 */
async function initializeKeys() {
  const created = [];
  const existing = [];

  // SSH keys
  for (const type of ['rsa', 'ed25519']) {
    try {
      const result = await generateSshKeyPair(type);
      if (result.created) {
        created.push(`ssh_host_${type}_key`);
      } else {
        existing.push(`ssh_host_${type}_key`);
      }
    } catch (error) {
      console.error(`Failed to generate SSH ${type} key:`, error.message);
    }
  }

  // Dropbear keys
  for (const type of ['rsa', 'ecdsa', 'ed25519']) {
    try {
      const result = await generateDropbearKey(type);
      if (result.created) {
        created.push(`dropbear_${type}_host_key`);
      } else {
        existing.push(`dropbear_${type}_host_key`);
      }
    } catch (error) {
      console.error(`Failed to generate Dropbear ${type} key:`, error.message);
    }
  }

  return { created, existing };
}

module.exports = {
  updateLinbofs,
  updateLinbofsStream,
  verifyLinbofs,
  getLinbofsInfo,
  checkKeyFiles,
  generateSshKeyPair,
  generateDropbearKey,
  initializeKeys,
};
