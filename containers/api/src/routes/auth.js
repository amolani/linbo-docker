/**
 * LINBO Docker - Auth Routes
 * POST /auth/login, /auth/logout, GET /auth/me
 */

const express = require('express');
const router = express.Router();
const { prisma } = require('../lib/prisma');
const {
  generateToken,
  comparePassword,
  authenticateToken,
  hashPassword,
} = require('../middleware/auth');
const { validateBody, loginSchema, createUserSchema } = require('../middleware/validate');
const { auditAction } = require('../middleware/audit');

/**
 * POST /auth/login
 * Authenticate user and return JWT token
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

      // Find user by username
      const user = await prisma.user.findUnique({
        where: { username },
      });

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
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
      });

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
    // For enhanced security, you could add token to a blocklist in Redis
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
    const user = await prisma.user.findUnique({
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

      const { username, email, password, role } = req.body;

      // Check if username exists
      const existing = await prisma.user.findUnique({
        where: { username },
      });

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

      // Get user with password hash
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
      });

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
