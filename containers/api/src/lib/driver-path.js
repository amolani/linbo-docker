/**
 * LINBO Docker - Driver Path Utilities
 * Single source of truth for all patchclass/driver paths, constants, and security checks
 */

const fs = require('fs').promises;
const path = require('path');

// =============================================================================
// Constants — Single Source of Truth
// =============================================================================

const LINBO_DIR = process.env.LINBO_DIR || process.env.SRV_LINBO_DIR || '/srv/linbo';
// Default: dedicated driver volume; fallback to legacy path for backward compat
const PATCHCLASS_BASE = process.env.PATCHCLASS_BASE || '/var/lib/linbo/drivers';
const IMAGE_DIR = process.env.IMAGE_DIR || path.join(LINBO_DIR, 'images');
const MAX_ZIP_ENTRIES = 1000;
const MAX_ZIP_SIZE = 500 * 1024 * 1024; // 500MB

// =============================================================================
// Path Security
// =============================================================================

/**
 * Validate a patchclass or driver set name
 * @param {string} name - Name to validate
 * @returns {string} Validated name
 * @throws {Error} with statusCode 400
 */
function sanitizeName(name) {
  if (!name || typeof name !== 'string') {
    throw Object.assign(new Error('Name must not be empty'), { statusCode: 400 });
  }
  const trimmed = name.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(trimmed)) {
    throw Object.assign(
      new Error('Name must start with alphanumeric, contain only [a-zA-Z0-9._-], max 100 chars'),
      { statusCode: 400 }
    );
  }
  return trimmed;
}

/**
 * Validate a relative file path (for uploads/deletions within a driver set)
 * @param {string} relPath - Relative path to validate
 * @returns {string} Validated relative path
 * @throws {Error} with statusCode 400
 */
function sanitizeRelativePath(relPath) {
  if (!relPath || typeof relPath !== 'string') {
    throw Object.assign(new Error('Path must not be empty'), { statusCode: 400 });
  }
  const trimmed = relPath.trim();

  if (trimmed.startsWith('/')) {
    throw Object.assign(new Error('Absolute paths not allowed'), { statusCode: 400 });
  }
  if (trimmed.includes('\\')) {
    throw Object.assign(new Error('Backslashes not allowed'), { statusCode: 400 });
  }
  if (trimmed.includes('\0')) {
    throw Object.assign(new Error('NUL bytes not allowed'), { statusCode: 400 });
  }

  // Segment-based traversal check
  const segments = trimmed.split('/');
  for (const seg of segments) {
    if (seg === '..') {
      throw Object.assign(new Error('Path traversal not allowed'), { statusCode: 400 });
    }
    if (seg === '') continue; // Allow trailing slashes
  }

  return trimmed.replace(/\/+/g, '/').replace(/\/$/, '');
}

/**
 * Resolve a path within PATCHCLASS_BASE and verify it stays inside
 * @param {string} pcName - Patchclass name
 * @param {...string} segments - Additional path segments
 * @returns {Promise<string>} Resolved absolute path
 * @throws {Error} with statusCode 400 on traversal
 */
async function resolveAndValidate(pcName, ...segments) {
  const target = path.join(PATCHCLASS_BASE, pcName, ...segments);

  // For new paths that don't exist yet, verify the resolved join stays within base
  const normalizedTarget = path.resolve(target);
  const normalizedBase = path.resolve(PATCHCLASS_BASE);
  if (normalizedTarget !== normalizedBase && !normalizedTarget.startsWith(normalizedBase + path.sep)) {
    throw Object.assign(new Error('Path traversal detected'), { statusCode: 400 });
  }

  // If path exists, also check realpath
  try {
    const real = await fs.realpath(target);
    if (real !== normalizedBase && !real.startsWith(normalizedBase + path.sep)) {
      throw Object.assign(new Error('Symlink points outside patchclass base'), { statusCode: 400 });
    }
    return real;
  } catch (err) {
    if (err.statusCode) throw err;
    // Path doesn't exist yet — the normalize check above is sufficient
    return normalizedTarget;
  }
}

/**
 * Convenience: resolve a path under PATCHCLASS_BASE/<pcName>/...segments
 * Does NOT validate pcName — caller should sanitizeName() first
 * @param {string} pcName - Patchclass name (already sanitized)
 * @param {...string} segments - Additional path segments
 * @returns {string} Joined path (not validated, use resolveAndValidate for security)
 */
function resolveDriverPath(pcName, ...segments) {
  return path.join(PATCHCLASS_BASE, pcName, ...segments);
}

module.exports = {
  LINBO_DIR,
  PATCHCLASS_BASE,
  IMAGE_DIR,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_SIZE,
  sanitizeName,
  sanitizeRelativePath,
  resolveAndValidate,
  resolveDriverPath,
};
