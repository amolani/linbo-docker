/**
 * LINBO Docker - Auth Routes
 * POST /auth/login, /auth/logout, GET /auth/me
 *
 * Supports two modes:
 *   1. Standalone (Prisma): full user management via database
 *   2. Sync/env-login: ADMIN_PASSWORD env var for admin access (no DB needed)
 */

const express = require('express');
const router = express.Router();

// Prisma is optional — may not be available in sync mode
let prisma = null;
try {
  prisma = require('../lib/prisma').prisma;
} catch {}

const {
  generateToken,
  comparePassword,
  authenticateToken,
  hashPassword,
} = require('../middleware/auth');
const { validateBody, loginSchema, createUserSchema } = require('../middleware/validate');

// Audit middleware: optional (depends on Prisma)
let auditAction;
try {
  auditAction = require('../middleware/audit').auditAction;
} catch {
  auditAction = () => (req, res, next) => next();
}

/**
 * POST /auth/login
 * Authenticate user and return JWT token.
 * Checks env-based admin credentials first, then falls back to Prisma DB.
 */
router.post(
  '/login',
  validateBody(loginSchema),
  auditAction('auth.login', {
    getTargetType: () => 'user',
    getTargetId: () => null,
    getTargetName: (req) => req.body.username,
    getChanges: () => ({}), // Don't log password
  }),
  async (req, res, next) => {
    try {
      const { username, password } = req.body;

      // --- Env-based admin login (works without DB) ---
      const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
      const ADMIN_PASS = process.env.ADMIN_PASSWORD;

      if (ADMIN_PASS && username === ADMIN_USER && password === ADMIN_PASS) {
        const token = generateToken({
          id: 'env-admin',
          username: ADMIN_USER,
          email: null,
          role: 'admin',
        });
        return res.json({
          data: {
            token,
            user: {
              id: 'env-admin',
              username: ADMIN_USER,
              role: 'admin',
            },
          },
        });
      }

      // --- Prisma DB user lookup ---
      if (!prisma) {
        return res.status(401).json({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid username or password',
          },
        });
      }

      let user;
      try {
        user = await prisma.user.findUnique({
          where: { username },
        });
      } catch (err) {
        console.error('[Auth] Prisma lookup failed:', err.message);
        return res.status(503).json({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Database not available',
          },
        });
      }

      if (!user) {
        return res.status(401).json({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid username or password',
          },
        });
      }

      // Check if user is active
      if (!user.active) {
        return res.status(401).json({
          error: {
            code: 'ACCOUNT_DISABLED',
            message: 'This account has been disabled',
          },
        });
      }

      // Verify password
      const isValid = await comparePassword(password, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid username or password',
          },
        });
      }

      // Update last login
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLogin: new Date() },
        });
      } catch {
        // Non-critical — don't fail login if update fails
      }

      // Generate token
      const token = generateToken(user);

      res.json({
        data: {
          token,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /auth/logout
 * Logout (client-side token removal, optional server-side invalidation)
 */
router.post(
  '/logout',
  authenticateToken,
  auditAction('auth.logout'),
  async (req, res) => {
    // In a stateless JWT setup, logout is handled client-side
    res.json({
      data: {
        message: 'Logged out successfully',
      },
    });
  }
);

/**
 * GET /auth/me
 * Get current authenticated user
 */
router.get('/me', authenticateToken, async (req, res, next) => {
  try {
    // Env-admin user: return static data (no DB lookup)
    if (req.user.id === 'env-admin') {
      return res.json({
        data: {
          id: 'env-admin',
          username: req.user.username,
          email: null,
          role: 'admin',
          active: true,
          lastLogin: null,
          createdAt: null,
        },
      });
    }

    // Internal service user: return static data
    if (req.user.id === 'internal') {
      return res.json({
        data: {
          id: 'internal',
          username: 'internal-service',
          email: null,
          role: 'admin',
          active: true,
          lastLogin: null,
          createdAt: null,
        },
      });
    }

    if (!prisma) {
      return res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Database not available',
        },
      });
    }

    let user;
    try {
      user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          active: true,
          lastLogin: true,
          createdAt: true,
        },
      });
    } catch (err) {
      console.error('[Auth] Prisma lookup failed:', err.message);
      return res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Database not available',
        },
      });
    }

    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        },
      });
    }

    res.json({ data: user });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/register (Admin only)
 * Create new user
 */
router.post(
  '/register',
  authenticateToken,
  validateBody(createUserSchema),
  auditAction('auth.register', {
    getTargetType: () => 'user',
    getTargetName: (req) => req.body.username,
    getChanges: (req) => ({ username: req.body.username, role: req.body.role }),
  }),
  async (req, res, next) => {
    try {
      // Only admins can create users
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Only administrators can create users',
          },
        });
      }

      if (!prisma) {
        return res.status(503).json({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Database not available. User management requires a database.',
          },
        });
      }

      const { username, email, password, role } = req.body;

      let existing;
      try {
        existing = await prisma.user.findUnique({
          where: { username },
        });
      } catch (err) {
        console.error('[Auth] Prisma lookup failed:', err.message);
        return res.status(503).json({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Database not available',
          },
        });
      }

      if (existing) {
        return res.status(409).json({
          error: {
            code: 'USERNAME_EXISTS',
            message: 'Username already exists',
          },
        });
      }

      // Hash password and create user
      const passwordHash = await hashPassword(password);
      const user = await prisma.user.create({
        data: {
          username,
          email,
          passwordHash,
          role,
        },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          createdAt: true,
        },
      });

      res.status(201).json({ data: user });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /auth/password
 * Change own password
 */
router.put(
  '/password',
  authenticateToken,
  auditAction('auth.password_change'),
  async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Current password and new password are required',
          },
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'New password must be at least 6 characters',
          },
        });
      }

      // Env-admin users cannot change password via API
      if (req.user.id === 'env-admin') {
        return res.status(400).json({
          error: {
            code: 'NOT_SUPPORTED',
            message: 'Env-admin password is set via ADMIN_PASSWORD environment variable',
          },
        });
      }

      if (!prisma) {
        return res.status(503).json({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Database not available',
          },
        });
      }

      let user;
      try {
        user = await prisma.user.findUnique({
          where: { id: req.user.id },
        });
      } catch (err) {
        console.error('[Auth] Prisma lookup failed:', err.message);
        return res.status(503).json({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Database not available',
          },
        });
      }

      // Verify current password
      const isValid = await comparePassword(currentPassword, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({
          error: {
            code: 'INVALID_PASSWORD',
            message: 'Current password is incorrect',
          },
        });
      }

      // Update password
      const passwordHash = await hashPassword(newPassword);
      await prisma.user.update({
        where: { id: req.user.id },
        data: { passwordHash },
      });

      res.json({
        data: {
          message: 'Password changed successfully',
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
