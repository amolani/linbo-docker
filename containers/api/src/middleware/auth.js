/**
 * LINBO Docker - Authentication Middleware
 * JWT and API Key authentication with role-based access control
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { prisma } = require('../lib/prisma');

const JWT_SECRET = process.env.JWT_SECRET || 'linbo-docker-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

/**
 * Generate JWT token for user
 * @param {object} user - User object from database
 */
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Verify JWT token
 * @param {string} token - JWT token
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Hash password
 * @param {string} password - Plain text password
 */
async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

/**
 * Compare password with hash
 * @param {string} password - Plain text password
 * @param {string} hash - Password hash
 */
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Middleware: Authenticate JWT token from Authorization header
 * Also accepts INTERNAL_API_KEY as Bearer token for container-to-container auth
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Access token required',
      },
    });
  }

  // Check for internal API key (container-to-container auth)
  const internalKey = process.env.INTERNAL_API_KEY;
  if (internalKey && token === internalKey) {
    req.user = { id: 'internal', username: 'internal-service', role: 'admin' };
    return next();
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Access token has expired',
        },
      });
    }
    return res.status(403).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid access token',
      },
    });
  }
}

/**
 * Middleware: Authenticate via X-API-Key header
 */
async function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'API key required',
      },
    });
  }

  try {
    // Hash the provided key and look it up
    const keyHash = await bcrypt.hash(apiKey, 10);

    // Find API key (we need to check all keys since bcrypt hashes are different each time)
    const apiKeys = await prisma.apiKey.findMany({
      include: { createdBy: true },
    });

    let matchedKey = null;
    for (const key of apiKeys) {
      const isMatch = await bcrypt.compare(apiKey, key.keyHash);
      if (isMatch) {
        matchedKey = key;
        break;
      }
    }

    if (!matchedKey) {
      return res.status(401).json({
        error: {
          code: 'INVALID_API_KEY',
          message: 'Invalid API key',
        },
      });
    }

    // Check expiration
    if (matchedKey.expiresAt && new Date() > matchedKey.expiresAt) {
      return res.status(401).json({
        error: {
          code: 'API_KEY_EXPIRED',
          message: 'API key has expired',
        },
      });
    }

    // Update last used
    await prisma.apiKey.update({
      where: { id: matchedKey.id },
      data: { lastUsedAt: new Date() },
    });

    // Set user from API key creator or create anonymous context
    req.user = matchedKey.createdBy
      ? {
          id: matchedKey.createdBy.id,
          username: matchedKey.createdBy.username,
          role: matchedKey.createdBy.role,
        }
      : {
          id: matchedKey.id,
          username: `api-key:${matchedKey.name}`,
          role: 'api',
        };
    req.apiKey = matchedKey;

    next();
  } catch (error) {
    console.error('API key authentication error:', error);
    return res.status(500).json({
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication error',
      },
    });
  }
}

/**
 * Middleware: Allow either JWT or API Key authentication
 */
function authenticateAny(req, res, next) {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateToken(req, res, next);
  } else if (apiKey) {
    return authenticateApiKey(req, res, next);
  } else {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required (Bearer token or X-API-Key)',
      },
    });
  }
}

/**
 * Middleware factory: Require specific roles
 * @param {string[]} allowedRoles - Array of allowed role names
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `This action requires one of these roles: ${allowedRoles.join(', ')}`,
        },
      });
    }

    next();
  };
}

/**
 * Optional authentication - populates req.user if token is valid, but doesn't fail if missing
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = verifyToken(token);
      req.user = decoded;
    } catch {
      // Token invalid, but that's OK for optional auth
    }
  }
  next();
}

module.exports = {
  generateToken,
  verifyToken,
  hashPassword,
  comparePassword,
  authenticateToken,
  authenticateApiKey,
  authenticateAny,
  requireRole,
  optionalAuth,
  JWT_SECRET,
  JWT_EXPIRES_IN,
};
