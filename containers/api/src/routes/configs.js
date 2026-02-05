/**
 * LINBO Docker - Configs Routes
 * CRUD operations for configuration management
 */

const express = require('express');
const router = express.Router();
const { prisma } = require('../lib/prisma');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  validateBody,
  createConfigSchema,
  updateConfigSchema,
} = require('../middleware/validate');
const { auditAction } = require('../middleware/audit');
const redis = require('../lib/redis');
const ws = require('../lib/websocket');
const configService = require('../services/config.service');

/**
 * GET /configs
 * List all configurations
 */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { status } = req.query;

    const where = {};
    if (status) where.status = status;

    const configs = await prisma.config.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: {
            hosts: true,
            hostGroups: true,
            partitions: true,
            osEntries: true,
          },
        },
      },
    });

    // Transform data
    const data = configs.map(config => ({
      ...config,
      hostCount: config._count.hosts,
      groupCount: config._count.hostGroups,
      partitionCount: config._count.partitions,
      osCount: config._count.osEntries,
      _count: undefined,
    }));

    res.json({ data });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /configs/:id
 * Get single config with partitions and OS entries
 */
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const config = await prisma.config.findUnique({
      where: { id: req.params.id },
      include: {
        partitions: { orderBy: { position: 'asc' } },
        osEntries: { orderBy: { position: 'asc' } },
        hosts: {
          select: { id: true, hostname: true },
          orderBy: { hostname: 'asc' },
        },
        hostGroups: {
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!config) {
      return res.status(404).json({
        error: {
          code: 'CONFIG_NOT_FOUND',
          message: 'Configuration not found',
        },
      });
    }

    res.json({ data: config });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /configs/:id/preview
 * Preview config as start.conf text
 */
router.get('/:id/preview', authenticateToken, async (req, res, next) => {
  try {
    const config = await prisma.config.findUnique({
      where: { id: req.params.id },
      include: {
        partitions: { orderBy: { position: 'asc' } },
        osEntries: { orderBy: { position: 'asc' } },
      },
    });

    if (!config) {
      return res.status(404).json({
        error: {
          code: 'CONFIG_NOT_FOUND',
          message: 'Configuration not found',
        },
      });
    }

    // Generate start.conf format
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
      DownloadType: 'torrent',
      GuiDisabled: 'no',
      UseMinimalLayout: 'no',
      Locale: 'de-de',
      SystemType: 'bios64',
      KernelOptions: '',
    };

    for (const [key, defaultValue] of Object.entries(defaultSettings)) {
      const value = linboSettings[key] !== undefined ? linboSettings[key] : defaultValue;
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

    const content = lines.join('\n');

    // Set content type based on format query param
    const format = req.query.format || 'text';
    if (format === 'json') {
      res.json({ data: { content, lines: lines.length } });
    } else {
      res.type('text/plain').send(content);
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /configs
 * Create new configuration
 */
router.post(
  '/',
  authenticateToken,
  requireRole(['admin', 'operator']),
  validateBody(createConfigSchema),
  auditAction('config.create', {
    getTargetId: (req, data) => data?.data?.id,
    getTargetName: (req) => req.body.name,
  }),
  async (req, res, next) => {
    try {
      const { partitions, osEntries, ...configData } = req.body;

      // Create config with nested partitions and OS entries
      const config = await prisma.config.create({
        data: {
          ...configData,
          createdBy: req.user.username,
          partitions: partitions ? {
            create: partitions,
          } : undefined,
          osEntries: osEntries ? {
            create: osEntries,
          } : undefined,
        },
        include: {
          partitions: { orderBy: { position: 'asc' } },
          osEntries: { orderBy: { position: 'asc' } },
        },
      });

      // Invalidate cache
      await redis.delPattern('configs:*');

      res.status(201).json({ data: config });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /configs/:id
 * Update configuration
 */
router.patch(
  '/:id',
  authenticateToken,
  requireRole(['admin', 'operator']),
  validateBody(updateConfigSchema),
  auditAction('config.update', {
    getTargetName: (req, data) => data?.data?.name,
  }),
  async (req, res, next) => {
    try {
      const { partitions, osEntries, ...configData } = req.body;

      // Update in transaction
      const config = await prisma.$transaction(async (tx) => {
        // Update main config
        const updated = await tx.config.update({
          where: { id: req.params.id },
          data: configData,
        });

        // Replace partitions if provided
        if (partitions !== undefined) {
          await tx.configPartition.deleteMany({
            where: { configId: req.params.id },
          });
          if (partitions.length > 0) {
            await tx.configPartition.createMany({
              data: partitions.map(p => ({ ...p, configId: req.params.id })),
            });
          }
        }

        // Replace OS entries if provided
        if (osEntries !== undefined) {
          await tx.configOs.deleteMany({
            where: { configId: req.params.id },
          });
          if (osEntries.length > 0) {
            await tx.configOs.createMany({
              data: osEntries.map(os => ({ ...os, configId: req.params.id })),
            });
          }
        }

        // Return updated config with relations
        return tx.config.findUnique({
          where: { id: req.params.id },
          include: {
            partitions: { orderBy: { position: 'asc' } },
            osEntries: { orderBy: { position: 'asc' } },
          },
        });
      });

      // Invalidate cache
      await redis.delPattern('configs:*');

      res.json({ data: config });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: {
            code: 'CONFIG_NOT_FOUND',
            message: 'Configuration not found',
          },
        });
      }
      next(error);
    }
  }
);

/**
 * DELETE /configs/:id
 * Delete configuration
 */
router.delete(
  '/:id',
  authenticateToken,
  requireRole(['admin']),
  auditAction('config.delete'),
  async (req, res, next) => {
    try {
      // Check if config is in use
      const config = await prisma.config.findUnique({
        where: { id: req.params.id },
        include: {
          _count: { select: { hosts: true, hostGroups: true } },
        },
      });

      if (!config) {
        return res.status(404).json({
          error: {
            code: 'CONFIG_NOT_FOUND',
            message: 'Configuration not found',
          },
        });
      }

      const totalUsage = config._count.hosts + config._count.hostGroups;
      if (totalUsage > 0 && !req.query.force) {
        return res.status(400).json({
          error: {
            code: 'CONFIG_IN_USE',
            message: `Config is used by ${config._count.hosts} hosts and ${config._count.hostGroups} groups. Add ?force=true to delete anyway.`,
          },
        });
      }

      // Delete config (partitions and OS entries cascade)
      await prisma.config.delete({
        where: { id: req.params.id },
      });

      // Invalidate cache
      await redis.delPattern('configs:*');

      res.json({
        data: {
          message: 'Configuration deleted successfully',
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /configs/:id/apply-to-groups
 * Apply config to specified groups
 */
router.post(
  '/:id/apply-to-groups',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('config.apply_to_groups'),
  async (req, res, next) => {
    try {
      const { groupIds } = req.body;

      if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'groupIds array is required',
          },
        });
      }

      // Verify config exists
      const config = await prisma.config.findUnique({
        where: { id: req.params.id },
      });

      if (!config) {
        return res.status(404).json({
          error: {
            code: 'CONFIG_NOT_FOUND',
            message: 'Configuration not found',
          },
        });
      }

      // Update groups and their hosts
      const result = await prisma.$transaction(async (tx) => {
        // Update groups' default config
        await tx.hostGroup.updateMany({
          where: { id: { in: groupIds } },
          data: { defaultConfigId: req.params.id },
        });

        // Update all hosts in those groups
        const hostResult = await tx.host.updateMany({
          where: { groupId: { in: groupIds } },
          data: { configId: req.params.id },
        });

        return hostResult;
      });

      // Invalidate cache
      await redis.delPattern('hosts:*');
      await redis.delPattern('groups:*');

      res.json({
        data: {
          message: `Config applied to ${groupIds.length} groups and ${result.count} hosts`,
          groupCount: groupIds.length,
          hostCount: result.count,
          configName: config.name,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /configs/:id/clone
 * Clone configuration
 */
router.post(
  '/:id/clone',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('config.clone'),
  async (req, res, next) => {
    try {
      const { name } = req.body;

      if (!name) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'New config name is required',
          },
        });
      }

      // Get source config with all relations
      const source = await prisma.config.findUnique({
        where: { id: req.params.id },
        include: {
          partitions: true,
          osEntries: true,
        },
      });

      if (!source) {
        return res.status(404).json({
          error: {
            code: 'CONFIG_NOT_FOUND',
            message: 'Configuration not found',
          },
        });
      }

      // Create clone
      const clone = await prisma.config.create({
        data: {
          name,
          description: source.description ? `Copy of: ${source.description}` : `Copy of ${source.name}`,
          version: '1.0.0',
          status: 'draft',
          linboSettings: source.linboSettings,
          createdBy: req.user.username,
          partitions: {
            create: source.partitions.map(p => ({
              position: p.position,
              device: p.device,
              label: p.label,
              size: p.size,
              partitionId: p.partitionId,
              fsType: p.fsType,
              bootable: p.bootable,
            })),
          },
          osEntries: {
            create: source.osEntries.map(os => ({
              position: os.position,
              name: os.name,
              description: os.description,
              osType: os.osType,
              iconName: os.iconName,
              baseImage: os.baseImage,
              differentialImage: os.differentialImage,
              rootDevice: os.rootDevice,
              kernel: os.kernel,
              initrd: os.initrd,
              append: os.append,
              startEnabled: os.startEnabled,
              syncEnabled: os.syncEnabled,
              newEnabled: os.newEnabled,
              autostart: os.autostart,
              autostartTimeout: os.autostartTimeout,
              defaultAction: os.defaultAction,
              prestartScript: os.prestartScript,
              postsyncScript: os.postsyncScript,
            })),
          },
        },
        include: {
          partitions: { orderBy: { position: 'asc' } },
          osEntries: { orderBy: { position: 'asc' } },
        },
      });

      // Invalidate cache
      await redis.delPattern('configs:*');

      res.status(201).json({ data: clone });
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_ENTRY',
            message: 'A configuration with this name already exists',
          },
        });
      }
      next(error);
    }
  }
);

/**
 * POST /configs/:id/deploy
 * Deploy config as start.conf file to /srv/linbo/ with optional host symlinks
 */
router.post(
  '/:id/deploy',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('config.deploy'),
  async (req, res, next) => {
    try {
      const { createSymlinks = true } = req.body || {};

      // Verify config exists
      const config = await prisma.config.findUnique({
        where: { id: req.params.id },
      });

      if (!config) {
        return res.status(404).json({
          error: {
            code: 'CONFIG_NOT_FOUND',
            message: 'Configuration not found',
          },
        });
      }

      // Deploy config file
      const result = await configService.deployConfig(req.params.id);

      // Create symlinks if requested
      let symlinkCount = 0;
      if (createSymlinks) {
        symlinkCount = await configService.createHostSymlinks(req.params.id);
      }

      // Update config status to 'active' and set deployedAt
      await prisma.config.update({
        where: { id: req.params.id },
        data: {
          status: 'active',
          metadata: {
            ...(config.metadata || {}),
            deployedAt: new Date().toISOString(),
            deployedBy: req.user.username,
          },
        },
      });

      // Broadcast deployment event
      ws.broadcast('config.deployed', {
        configId: req.params.id,
        configName: config.name,
        filepath: result.filepath,
        symlinkCount,
      });

      res.json({
        data: {
          ...result,
          configName: config.name,
          symlinkCount,
          message: `Config deployed successfully${symlinkCount > 0 ? ` with ${symlinkCount} symlinks` : ''}`,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /configs/deployed
 * List all deployed configs in /srv/linbo/
 */
router.get(
  '/deployed/list',
  authenticateToken,
  async (req, res, next) => {
    try {
      const configs = await configService.listDeployedConfigs();
      res.json({ data: configs });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /configs/deploy-all
 * Deploy all active configs
 */
router.post(
  '/deploy-all',
  authenticateToken,
  requireRole(['admin']),
  auditAction('config.deploy_all'),
  async (req, res, next) => {
    try {
      const result = await configService.deployAllConfigs();

      ws.broadcast('config.deploy_all_completed', {
        deployed: result.deployed,
        symlinks: result.symlinks,
      });

      res.json({
        data: {
          ...result,
          message: `Deployed ${result.deployed} configs with ${result.symlinks} symlinks`,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /configs/cleanup-symlinks
 * Remove orphaned symlinks
 */
router.post(
  '/cleanup-symlinks',
  authenticateToken,
  requireRole(['admin']),
  auditAction('config.cleanup_symlinks'),
  async (req, res, next) => {
    try {
      const removed = await configService.cleanupOrphanedSymlinks();

      res.json({
        data: {
          removed,
          message: `Removed ${removed} orphaned symlinks`,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /configs/:id/raw
 * Get raw start.conf content from deployed file
 */
router.get('/:id/raw', authenticateToken, async (req, res, next) => {
  try {
    const config = await prisma.config.findUnique({
      where: { id: req.params.id },
    });

    if (!config) {
      return res.status(404).json({
        error: {
          code: 'CONFIG_NOT_FOUND',
          message: 'Configuration not found',
        },
      });
    }

    // Get raw content from deployed file
    const result = await configService.getRawConfig(config.name);

    res.json({
      data: {
        configId: config.id,
        configName: config.name,
        content: result.content,
        filepath: result.filepath,
        exists: result.exists,
        lastModified: result.lastModified,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /configs/:id/raw
 * Save raw start.conf content directly to file
 */
router.put(
  '/:id/raw',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('config.update_raw', {
    getTargetName: (req, data) => data?.data?.configName,
  }),
  async (req, res, next) => {
    try {
      const { content } = req.body;

      if (!content || typeof content !== 'string') {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Content is required and must be a string',
          },
        });
      }

      const config = await prisma.config.findUnique({
        where: { id: req.params.id },
      });

      if (!config) {
        return res.status(404).json({
          error: {
            code: 'CONFIG_NOT_FOUND',
            message: 'Configuration not found',
          },
        });
      }

      // Save raw content to file
      const result = await configService.saveRawConfig(config.name, content);

      // Update config metadata
      await prisma.config.update({
        where: { id: req.params.id },
        data: {
          metadata: {
            ...(config.metadata || {}),
            rawEditedAt: new Date().toISOString(),
            rawEditedBy: req.user.username,
          },
        },
      });

      // Broadcast update event
      ws.broadcast('config.raw_updated', {
        configId: config.id,
        configName: config.name,
        filepath: result.filepath,
      });

      res.json({
        data: {
          configId: config.id,
          configName: config.name,
          filepath: result.filepath,
          size: result.size,
          hash: result.hash,
          message: 'Raw config saved successfully',
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
