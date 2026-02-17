/**
 * LINBO Docker - Patchclass Service
 * Manages Windows driver patchclasses with DMI-based driver matching
 *
 * Business orchestration only — path security, shell escaping, and filesystem
 * utilities live in lib/driver-path.js, lib/driver-shell.js, lib/driver-fs.js
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { z } = require('zod');
const ws = require('../lib/websocket');

// Import from lib/ modules (single source of truth)
const {
  PATCHCLASS_BASE, IMAGE_DIR, MAX_ZIP_ENTRIES, MAX_ZIP_SIZE,
  sanitizeName, sanitizeRelativePath, resolveAndValidate,
} = require('../lib/driver-path');
const { shellEscapeExact, shellEscapeContains } = require('../lib/driver-shell');
const {
  listDirRecursive, countFiles, getDirSize, removeSymlinks, generateManifest,
} = require('../lib/driver-fs');

// =============================================================================
// Zod Schema for driver-map.json
// =============================================================================

const driverMapModelSchema = z.object({
  name: z.string().min(1).max(200),
  match: z.object({
    sys_vendor: z.string().min(1).max(200),
    product_name: z.string().max(200).optional(),
    product_name_contains: z.string().max(200).optional(),
  }).refine(
    d => d.product_name !== undefined || d.product_name_contains !== undefined,
    { message: 'Either product_name or product_name_contains is required' }
  ),
  drivers: z.array(z.string().min(1).max(100)).min(1),
});

const deviceRuleSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(50),
  match: z.object({
    type: z.enum(['pci', 'usb']),
    vendor: z.string().regex(/^[0-9a-fA-F]{4}$/),
    device: z.string().regex(/^[0-9a-fA-F]{4}$/),
    subvendor: z.string().regex(/^[0-9a-fA-F]{4}$/).optional(),
    subdevice: z.string().regex(/^[0-9a-fA-F]{4}$/).optional(),
  }),
  drivers: z.array(z.string().min(1).max(100)).min(1),
});

const driverMapSchema = z.object({
  version: z.number().int().min(1).max(100).default(1),
  defaultDrivers: z.array(z.string().min(1).max(100)).default(['_generic']),
  ignoredCategories: z.array(z.string().min(1).max(50)).default([]),
  models: z.array(driverMapModelSchema).default([]),
  deviceRules: z.array(deviceRuleSchema).default([]),
});

// =============================================================================
// Patchclass CRUD
// =============================================================================

/**
 * List all patchclasses with stats
 */
async function listPatchclasses() {
  try {
    await fs.mkdir(PATCHCLASS_BASE, { recursive: true });
  } catch { /* exists */ }

  const entries = await fs.readdir(PATCHCLASS_BASE, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const pcDir = path.join(PATCHCLASS_BASE, entry.name);
    let modelCount = 0;
    let driverSetCount = 0;
    let totalSize = 0;

    // Count models from driver-map.json
    try {
      const mapRaw = await fs.readFile(path.join(pcDir, 'driver-map.json'), 'utf-8');
      const map = JSON.parse(mapRaw);
      modelCount = Array.isArray(map.models) ? map.models.length : 0;
    } catch { /* no map */ }

    // Count driver sets
    try {
      const driversDir = path.join(pcDir, 'drivers');
      const driverEntries = await fs.readdir(driversDir, { withFileTypes: true });
      for (const de of driverEntries) {
        if (de.isDirectory()) {
          driverSetCount++;
          totalSize += await getDirSize(path.join(driversDir, de.name));
        }
      }
    } catch { /* no drivers dir */ }

    results.push({
      name: entry.name,
      modelCount,
      driverSetCount,
      totalSize,
    });
  }

  return results;
}

/**
 * Create a new patchclass with directory structure
 */
async function createPatchclass(name) {
  const pcName = sanitizeName(name);
  const pcDir = await resolveAndValidate(pcName);

  // Check if already exists
  try {
    await fs.access(pcDir);
    throw Object.assign(new Error(`Patchclass already exists: ${pcName}`), { statusCode: 409 });
  } catch (err) {
    if (err.statusCode) throw err;
  }

  // Create directory structure
  await fs.mkdir(path.join(pcDir, 'drivers'), { recursive: true });
  await fs.mkdir(path.join(pcDir, 'common', 'postsync.d'), { recursive: true });

  // Create empty driver-map.json
  const emptyMap = { version: 1, defaultDrivers: ['_generic'], ignoredCategories: [], models: [], deviceRules: [] };
  await fs.writeFile(
    path.join(pcDir, 'driver-map.json'),
    JSON.stringify(emptyMap, null, 2) + '\n',
    { mode: 0o644 }
  );

  // Generate initial driver-rules.sh and match script
  await regenerateRules(pcName);

  ws.broadcast('patchclass.created', { name: pcName });

  return { name: pcName, modelCount: 0, driverSetCount: 0, totalSize: 0 };
}

/**
 * Delete a patchclass
 */
async function deletePatchclass(name) {
  const pcName = sanitizeName(name);
  const pcDir = await resolveAndValidate(pcName);

  try {
    await fs.access(pcDir);
  } catch {
    throw Object.assign(new Error(`Patchclass not found: ${pcName}`), { statusCode: 404 });
  }

  await fs.rm(pcDir, { recursive: true, force: true });
  ws.broadcast('patchclass.deleted', { name: pcName });

  return { deleted: pcName };
}

/**
 * Get detail info for a patchclass
 */
async function getPatchclassDetail(name) {
  const pcName = sanitizeName(name);
  const pcDir = await resolveAndValidate(pcName);

  try {
    await fs.access(pcDir);
  } catch {
    throw Object.assign(new Error(`Patchclass not found: ${pcName}`), { statusCode: 404 });
  }

  const sets = await listDriverSets(pcName);
  let map = { version: 1, defaultDrivers: ['_generic'], models: [] };
  try {
    map = await getDriverMap(pcName);
  } catch { /* no map yet */ }

  let totalSize = 0;
  for (const s of sets) totalSize += s.totalSize;

  return {
    name: pcName,
    modelCount: map.models.length,
    driverSetCount: sets.length,
    totalSize,
    driverSets: sets,
    driverMap: map,
  };
}

// =============================================================================
// Driver Set CRUD
// =============================================================================

/**
 * List driver sets for a patchclass
 */
async function listDriverSets(pcName) {
  pcName = sanitizeName(pcName);
  const driversDir = await resolveAndValidate(pcName, 'drivers');

  try {
    const entries = await fs.readdir(driversDir, { withFileTypes: true });
    const results = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const setDir = path.join(driversDir, entry.name);
      const fileCount = await countFiles(setDir);
      const totalSize = await getDirSize(setDir);
      results.push({ name: entry.name, fileCount, totalSize });
    }

    return results;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Create a new driver set directory
 */
async function createDriverSet(pcName, setName) {
  pcName = sanitizeName(pcName);
  setName = sanitizeName(setName);
  const setDir = await resolveAndValidate(pcName, 'drivers', setName);

  // Verify patchclass exists
  const pcDir = await resolveAndValidate(pcName);
  try {
    await fs.access(pcDir);
  } catch {
    throw Object.assign(new Error(`Patchclass not found: ${pcName}`), { statusCode: 404 });
  }

  try {
    await fs.access(setDir);
    throw Object.assign(new Error(`Driver set already exists: ${setName}`), { statusCode: 409 });
  } catch (err) {
    if (err.statusCode) throw err;
  }

  await fs.mkdir(setDir, { recursive: true });

  // Regenerate manifest after structural change
  await regenerateManifestForPatchclass(pcName);

  ws.broadcast('patchclass.driver_set_created', { patchclass: pcName, set: setName });

  return { name: setName, fileCount: 0, totalSize: 0 };
}

/**
 * Delete a driver set
 */
async function deleteDriverSet(pcName, setName) {
  pcName = sanitizeName(pcName);
  setName = sanitizeName(setName);
  const setDir = await resolveAndValidate(pcName, 'drivers', setName);

  try {
    await fs.access(setDir);
  } catch {
    throw Object.assign(new Error(`Driver set not found: ${setName}`), { statusCode: 404 });
  }

  await fs.rm(setDir, { recursive: true, force: true });

  // Regenerate manifest after structural change
  await regenerateManifestForPatchclass(pcName);

  ws.broadcast('patchclass.driver_set_deleted', { patchclass: pcName, set: setName });

  return { deleted: setName };
}

/**
 * List files in a driver set
 */
async function listDriverSetFiles(pcName, setName) {
  pcName = sanitizeName(pcName);
  setName = sanitizeName(setName);
  const setDir = await resolveAndValidate(pcName, 'drivers', setName);

  try {
    return await listDirRecursive(setDir, '');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw Object.assign(new Error(`Driver set not found: ${setName}`), { statusCode: 404 });
    }
    throw err;
  }
}

/**
 * Upload a driver file to a set
 */
async function uploadDriverFile(pcName, setName, relPath, buffer) {
  pcName = sanitizeName(pcName);
  setName = sanitizeName(setName);
  relPath = sanitizeRelativePath(relPath);

  const filePath = await resolveAndValidate(pcName, 'drivers', setName, relPath);

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer, { mode: 0o644 });

  // Regenerate manifest after content change
  await regenerateManifestForPatchclass(pcName);

  const stat = await fs.stat(filePath);
  return { path: relPath, size: stat.size };
}

/**
 * Delete a driver file from a set
 */
async function deleteDriverFile(pcName, setName, relPath) {
  pcName = sanitizeName(pcName);
  setName = sanitizeName(setName);
  relPath = sanitizeRelativePath(relPath);

  const filePath = await resolveAndValidate(pcName, 'drivers', setName, relPath);

  try {
    await fs.access(filePath);
  } catch {
    throw Object.assign(new Error(`File not found: ${relPath}`), { statusCode: 404 });
  }

  await fs.unlink(filePath);

  // Regenerate manifest after content change
  await regenerateManifestForPatchclass(pcName);

  return { deleted: relPath };
}

/**
 * Extract a ZIP file into a driver set with security checks
 */
async function extractDriverZip(pcName, setName, zipPath) {
  pcName = sanitizeName(pcName);
  setName = sanitizeName(setName);

  const setDir = await resolveAndValidate(pcName, 'drivers', setName);

  // Verify set directory exists
  try {
    await fs.access(setDir);
  } catch {
    throw Object.assign(new Error(`Driver set not found: ${setName}`), { statusCode: 404 });
  }

  // Use unzip with security checks
  const { execFile } = require('child_process');

  function execFileAsync(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, opts, (err, stdout, stderr) => {
        if (err) { err.stdout = stdout; err.stderr = stderr; reject(err); }
        else resolve({ stdout, stderr });
      });
    });
  }

  // First, list ZIP contents for security validation
  let listOutput;
  try {
    const result = await execFileAsync('unzip', ['-l', zipPath], { maxBuffer: 10 * 1024 * 1024 });
    listOutput = result.stdout;
  } catch (err) {
    throw Object.assign(new Error('Invalid ZIP file: ' + (err.stderr || err.message)), { statusCode: 400 });
  }

  // Parse the listing to check entries
  const lines = listOutput.split('\n');
  let entryCount = 0;
  let totalUncompressed = 0;

  for (const line of lines) {
    // unzip -l output: "   size  date  time  name"
    const match = line.match(/^\s*(\d+)\s+\d{2}-\d{2}-\d{2,4}\s+\d{2}:\d{2}\s+(.+)$/);
    if (!match) continue;

    const size = parseInt(match[1], 10);
    const entryName = match[2];
    entryCount++;

    // Security checks
    if (entryName.includes('..')) {
      throw Object.assign(new Error(`ZIP contains path traversal: ${entryName}`), { statusCode: 400 });
    }
    if (entryName.startsWith('/')) {
      throw Object.assign(new Error(`ZIP contains absolute path: ${entryName}`), { statusCode: 400 });
    }

    totalUncompressed += size;
  }

  if (entryCount > MAX_ZIP_ENTRIES) {
    throw Object.assign(
      new Error(`ZIP contains too many entries: ${entryCount} (max ${MAX_ZIP_ENTRIES})`),
      { statusCode: 400 }
    );
  }

  if (totalUncompressed > MAX_ZIP_SIZE) {
    throw Object.assign(
      new Error(`ZIP uncompressed size too large: ${Math.round(totalUncompressed / 1024 / 1024)}MB (max ${Math.round(MAX_ZIP_SIZE / 1024 / 1024)}MB)`),
      { statusCode: 400 }
    );
  }

  // Extract to set directory (no symlinks via -K)
  try {
    await execFileAsync('unzip', ['-o', '-K', zipPath, '-d', setDir], {
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    throw Object.assign(
      new Error('ZIP extraction failed: ' + (err.stderr || err.message)),
      { statusCode: 500 }
    );
  }

  // Post-extraction: remove any symlinks that may have snuck in
  await removeSymlinks(setDir);

  // Regenerate manifest after content change
  await regenerateManifestForPatchclass(pcName);

  return { entryCount, totalUncompressed };
}

// =============================================================================
// Driver Map CRUD
// =============================================================================

/**
 * Read and validate driver-map.json for a patchclass
 */
async function getDriverMap(pcName) {
  pcName = sanitizeName(pcName);
  const mapPath = await resolveAndValidate(pcName, 'driver-map.json');

  try {
    const raw = await fs.readFile(mapPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return driverMapSchema.parse(parsed);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { version: 1, defaultDrivers: ['_generic'], models: [] };
    }
    if (err instanceof z.ZodError) {
      throw Object.assign(
        new Error('Invalid driver-map.json: ' + err.issues.map(i => i.message).join(', ')),
        { statusCode: 400 }
      );
    }
    throw err;
  }
}

/**
 * Write driver-map.json atomically and regenerate rules
 */
async function updateDriverMap(pcName, mapData) {
  pcName = sanitizeName(pcName);

  // Validate the map data
  const validated = driverMapSchema.parse(mapData);

  const mapPath = await resolveAndValidate(pcName, 'driver-map.json');
  const tmp = mapPath + '.tmp.' + process.pid;

  await fs.writeFile(tmp, JSON.stringify(validated, null, 2) + '\n', { mode: 0o644 });
  await fs.rename(tmp, mapPath);

  // Regenerate rules from new map
  await regenerateRules(pcName);

  ws.broadcast('patchclass.driver_map_updated', { patchclass: pcName });

  return validated;
}

/**
 * Add a model to the driver map
 */
async function addModel(pcName, model) {
  const map = await getDriverMap(pcName);
  const validatedModel = driverMapModelSchema.parse(model);

  // Check for duplicate names
  if (map.models.some(m => m.name === validatedModel.name)) {
    throw Object.assign(
      new Error(`Model already exists: ${validatedModel.name}`),
      { statusCode: 409 }
    );
  }

  map.models.push(validatedModel);
  return updateDriverMap(pcName, map);
}

/**
 * Remove a model from the driver map by name
 */
async function removeModel(pcName, modelName) {
  const map = await getDriverMap(pcName);
  const idx = map.models.findIndex(m => m.name === modelName);
  if (idx === -1) {
    throw Object.assign(new Error(`Model not found: ${modelName}`), { statusCode: 404 });
  }
  map.models.splice(idx, 1);
  return updateDriverMap(pcName, map);
}

// =============================================================================
// Device Rule CRUD
// =============================================================================

/**
 * Add a device rule to the driver map
 */
async function addDeviceRule(pcName, rule) {
  const map = await getDriverMap(pcName);
  const validatedRule = deviceRuleSchema.parse(rule);

  // Check for duplicate names
  const existingRules = map.deviceRules || [];
  if (existingRules.some(r => r.name === validatedRule.name)) {
    throw Object.assign(
      new Error(`Device rule already exists: ${validatedRule.name}`),
      { statusCode: 409 }
    );
  }

  map.deviceRules = [...existingRules, validatedRule];
  return updateDriverMap(pcName, map);
}

/**
 * Remove a device rule from the driver map by name
 */
async function removeDeviceRule(pcName, ruleName) {
  const map = await getDriverMap(pcName);
  const rules = map.deviceRules || [];
  const idx = rules.findIndex(r => r.name === ruleName);
  if (idx === -1) {
    throw Object.assign(new Error(`Device rule not found: ${ruleName}`), { statusCode: 404 });
  }
  rules.splice(idx, 1);
  map.deviceRules = rules;
  return updateDriverMap(pcName, map);
}

// =============================================================================
// Rule Generation
// =============================================================================

/**
 * Generate driver-rules.sh from driver-map.json
 * Also regenerates common/postsync.d/00-match-drivers.sh and manifest
 */
async function regenerateRules(pcName) {
  pcName = sanitizeName(pcName);
  const map = await getDriverMap(pcName);

  // Compute hash for skip-optimization
  const mapHash = crypto.createHash('md5')
    .update(JSON.stringify(map))
    .digest('hex');

  // Generate case statement for DMI matching
  const lines = [
    '# Auto-generated by LINBO Docker API — DO NOT EDIT',
    `# Source: driver-map.json, generated ${new Date().toISOString()}`,
    `# Hash: ${mapHash}`,
    'match_drivers() {',
    '  local vendor="$1"',
    '  local product="$2"',
    '  case "$vendor|$product" in',
  ];

  for (const model of map.models) {
    const vendor = shellEscapeExact(model.match.sys_vendor);
    let pattern;
    if (model.match.product_name !== undefined) {
      // Exact match
      pattern = shellEscapeExact(model.match.product_name);
    } else {
      // Contains match
      pattern = shellEscapeContains(model.match.product_name_contains);
    }

    const driverSets = model.drivers.join(' ');
    lines.push(`    "${vendor}|${pattern}")`);
    lines.push(`      DRIVER_SETS="${driverSets}"`);
    lines.push('      ;;');
  }

  // Default case
  const defaultSets = map.defaultDrivers.join(' ');
  lines.push('    *)');
  lines.push(`      DRIVER_SETS="${defaultSets}"`);
  lines.push('      ;;');
  lines.push('  esac');
  lines.push('}');
  lines.push('');

  // Generate match_device_drivers() for PCI/USB-ID matching
  const activeDeviceRules = (map.deviceRules || []).filter(
    r => !(map.ignoredCategories || []).includes(r.category)
  );

  if (activeDeviceRules.length > 0) {
    lines.push('# PCI/USB-ID based device matching');
    lines.push('match_device_drivers() {');
    lines.push('  local hw_ids="$1"');
    lines.push('  local EXTRA_SETS=""');
    lines.push('  while IFS= read -r id; do');
    lines.push('    [ -z "$id" ] && continue');
    lines.push('    case "$id" in');

    // Sort: 4-tuple (subsystem) matches first, then 2-tuple (base)
    const subsystemRules = activeDeviceRules.filter(r => r.match.subvendor && r.match.subdevice);
    const baseRules = activeDeviceRules.filter(r => !r.match.subvendor || !r.match.subdevice);

    for (const rule of subsystemRules) {
      const pattern = `${rule.match.vendor}:${rule.match.device}:${rule.match.subvendor}:${rule.match.subdevice}`.toLowerCase();
      const sets = rule.drivers.join(' ');
      lines.push(`      # ${rule.name} (subsystem match)`);
      lines.push(`      "${pattern}") EXTRA_SETS="$EXTRA_SETS ${sets}" ;;`);
    }

    for (const rule of baseRules) {
      const pattern = `${rule.match.vendor}:${rule.match.device}`.toLowerCase();
      const sets = rule.drivers.join(' ');
      lines.push(`      # ${rule.name}`);
      lines.push(`      "${pattern}") EXTRA_SETS="$EXTRA_SETS ${sets}" ;;`);
    }

    lines.push('      *) ;;');
    lines.push('    esac');
    lines.push('  done <<EOF');
    lines.push('$hw_ids');
    lines.push('EOF');
    lines.push('  echo "$EXTRA_SETS" | tr \' \' \'\\n\' | sort -u | tr \'\\n\' \' \'');
    lines.push('}');
    lines.push('');
  }

  const rulesContent = lines.join('\n');
  const rulesPath = await resolveAndValidate(pcName, 'driver-rules.sh');
  const tmp = rulesPath + '.tmp.' + process.pid;
  await fs.writeFile(tmp, rulesContent, { mode: 0o644 });
  await fs.rename(tmp, rulesPath);

  // Regenerate match script
  await regenerateMatchScript(pcName);

  // Regenerate manifest
  const pcDir = await resolveAndValidate(pcName);
  await generateManifest(pcDir, mapHash);

  return { hash: mapHash, modelCount: map.models.length };
}

/**
 * Regenerate common/postsync.d/00-match-drivers.sh from template
 */
async function regenerateMatchScript(pcName) {
  pcName = sanitizeName(pcName);
  const templatePath = path.join(__dirname, '..', 'templates', '00-match-drivers.sh');
  const targetDir = await resolveAndValidate(pcName, 'common', 'postsync.d');
  const targetPath = path.join(targetDir, '00-match-drivers.sh');

  await fs.mkdir(targetDir, { recursive: true });

  const template = await fs.readFile(templatePath, 'utf-8');
  const tmp = targetPath + '.tmp.' + process.pid;
  await fs.writeFile(tmp, template, { mode: 0o755 });
  await fs.rename(tmp, targetPath);
}

// =============================================================================
// Manifest Regeneration Helper
// =============================================================================

/**
 * Regenerate driver-manifest.json for a patchclass
 * Called after any write operation (set create/delete, file upload/delete, zip extract)
 */
async function regenerateManifestForPatchclass(pcName) {
  try {
    const map = await getDriverMap(pcName);
    const mapHash = crypto.createHash('md5')
      .update(JSON.stringify(map))
      .digest('hex');
    const pcDir = await resolveAndValidate(pcName);
    await generateManifest(pcDir, mapHash);
  } catch {
    // Non-critical — manifest is a performance optimization, not required for correctness
  }
}

// =============================================================================
// Postsync Deployment
// =============================================================================

/**
 * Generate postsync script from template for a given patchclass + image
 */
async function generatePostsyncScript(pcName, imageName) {
  pcName = sanitizeName(pcName);

  const templatePath = path.join(__dirname, '..', 'templates', 'postsync-patchclass.sh');
  let template = await fs.readFile(templatePath, 'utf-8');

  template = template.replace(/\{\{PATCHCLASS\}\}/g, pcName);
  template = template.replace(/\{\{IMAGENAME\}\}/g, imageName);

  return template;
}

/**
 * Deploy postsync script to image directory
 */
async function deployPostsyncToImage(pcName, imageName) {
  pcName = sanitizeName(pcName);

  // Verify patchclass exists
  const pcDir = await resolveAndValidate(pcName);
  try {
    await fs.access(pcDir);
  } catch {
    throw Object.assign(new Error(`Patchclass not found: ${pcName}`), { statusCode: 404 });
  }

  // Sanitize image name
  if (!imageName || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(qcow2|cloop)$/.test(imageName)) {
    throw Object.assign(new Error('Invalid image name'), { statusCode: 400 });
  }

  const content = await generatePostsyncScript(pcName, imageName);
  const postsyncName = imageName.replace(/\.(qcow2|cloop)$/, '.postsync');
  const targetPath = path.join(IMAGE_DIR, postsyncName);

  const tmp = targetPath + '.tmp.' + process.pid;
  await fs.writeFile(tmp, content, { mode: 0o755 });
  await fs.rename(tmp, targetPath);

  ws.broadcast('patchclass.postsync_deployed', {
    patchclass: pcName,
    image: imageName,
    postsync: postsyncName,
  });

  return { postsync: postsyncName, patchclass: pcName, image: imageName };
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  // Re-export from lib/ for backward compatibility (tests import from service)
  PATCHCLASS_BASE,
  IMAGE_DIR,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_SIZE,
  sanitizeName,
  sanitizeRelativePath,
  resolveAndValidate,
  shellEscapeExact,
  shellEscapeContains,

  // Patchclass CRUD
  listPatchclasses,
  createPatchclass,
  deletePatchclass,
  getPatchclassDetail,

  // Driver Set CRUD
  listDriverSets,
  createDriverSet,
  deleteDriverSet,
  listDriverSetFiles,
  uploadDriverFile,
  deleteDriverFile,
  extractDriverZip,

  // Driver Map
  getDriverMap,
  updateDriverMap,
  addModel,
  removeModel,

  // Device Rules
  addDeviceRule,
  removeDeviceRule,

  // Rule generation
  regenerateRules,
  regenerateMatchScript,

  // Postsync
  generatePostsyncScript,
  deployPostsyncToImage,

  // Schema (for testing)
  driverMapSchema,
  driverMapModelSchema,
  deviceRuleSchema,
};
