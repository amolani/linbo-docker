/**
 * LINBO Docker - Route Aggregator
 * Combines all route modules with conditional mounting for sync mode.
 *
 * In sync mode (SYNC_ENABLED=true or LMN_API_URL set):
 *   - Prisma-dependent routes return 409 SYNC_MODE_ACTIVE
 *   - Auth uses env-based login (no DB)
 *   - Images use filesystem-only fallback
 *
 * In standalone mode (default):
 *   - All routes mounted normally with full Prisma support
 */

const express = require('express');
const router = express.Router();

const isSyncMode = process.env.SYNC_ENABLED === 'true' || !!process.env.LMN_API_URL;

// ---------------------------------------------------------------------------
// Routes that always work (no Prisma dependency)
// ---------------------------------------------------------------------------
const authRoutes = require('./auth');
const syncRoutes = require('./sync');
const internalRoutes = require('./internal');
const systemRoutes = require('./system');
const patchclassRoutes = require('./patchclass');
const settingsRoutes = require('./settings');

router.use('/auth', authRoutes);
router.use('/sync', syncRoutes);
router.use('/internal', internalRoutes);
router.use('/system', systemRoutes);
router.use('/patchclass', patchclassRoutes);
router.use('/settings', settingsRoutes);

// ---------------------------------------------------------------------------
// Images: always mounted (has Prisma-optional filesystem fallback)
// ---------------------------------------------------------------------------
const imageRoutes = require('./images');
router.use('/images', imageRoutes);

// ---------------------------------------------------------------------------
// Mode-dependent routes
// ---------------------------------------------------------------------------
if (isSyncMode) {
  // In sync mode, Prisma-dependent routes return 409
  const syncModeHandler = (req, res) => {
    res.status(409).json({
      error: {
        code: 'SYNC_MODE_ACTIVE',
        message: 'This endpoint is disabled in sync mode. Data is managed by the LMN Authority server.',
      },
    });
  };

  router.use('/hosts', syncModeHandler);
  router.use('/rooms', syncModeHandler);
  router.use('/configs', syncModeHandler);
  router.use('/operations', require('./sync-operations'));
  router.use('/stats', syncModeHandler);
  router.use('/dhcp', syncModeHandler);

  console.log('[Routes] Sync mode: Prisma-dependent routes disabled (hosts, rooms, configs, stats, dhcp); operations use Redis');
} else {
  // Standalone mode: mount all Prisma-dependent routes
  const hostRoutes = require('./hosts');
  const roomRoutes = require('./rooms');
  const configRoutes = require('./configs');
  const operationRoutes = require('./operations');
  const statsRoutes = require('./stats');
  const dhcpRoutes = require('./dhcp');

  router.use('/hosts', hostRoutes);
  router.use('/rooms', roomRoutes);
  router.use('/configs', configRoutes);
  router.use('/operations', operationRoutes);
  router.use('/stats', statsRoutes);
  router.use('/dhcp', dhcpRoutes);
}

// API info endpoint
router.get('/', (req, res) => {
  const baseEndpoints = {
    auth: {
      'POST /auth/login': 'Authenticate and get JWT token',
      'POST /auth/logout': 'Logout (invalidate token)',
      'GET /auth/me': 'Get current user info',
      'POST /auth/register': 'Create new user (admin only)',
      'PUT /auth/password': 'Change own password',
    },
    images: {
      'GET /images': 'List all images',
      'GET /images/:id': 'Get image details',
      'POST /images': 'Register new image',
      'POST /images/register': 'Register existing file',
      'PATCH /images/:id': 'Update image metadata',
      'DELETE /images/:id': 'Delete image',
      'POST /images/:id/verify': 'Verify checksum',
      'GET /images/:id/info': 'Get detailed file info',
    },
    sync: {
      'GET /sync/mode': 'Get current operating mode (no auth)',
      'GET /sync/status': 'Get sync status (cursor, counts, LMN API health)',
      'GET /sync/hosts': 'List hosts from sync cache',
      'GET /sync/hosts/:mac': 'Get single host from sync cache',
      'GET /sync/configs': 'List configs from sync cache',
      'GET /sync/configs/:id': 'Get single config from sync cache',
      'GET /sync/configs/:id/preview': 'Preview start.conf file content',
      'GET /sync/stats': 'Aggregated sync statistics',
      'POST /sync/trigger': 'Trigger sync from LMN Authority API (admin)',
      'POST /sync/reset': 'Reset cursor for full re-sync (admin)',
    },
    system: {
      'POST /system/update-linbofs': 'Update linbofs64 with keys',
      'GET /system/linbofs-status': 'Check linbofs64 configuration',
      'GET /system/linbofs-info': 'Get linbofs64 file info',
      'GET /system/key-status': 'Check available SSH keys',
      'POST /system/initialize-keys': 'Generate missing SSH keys',
      'POST /system/generate-ssh-key': 'Generate specific SSH key',
      'POST /system/generate-dropbear-key': 'Generate Dropbear key',
      'POST /system/regenerate-grub-configs': 'Regenerate GRUB configs',
    },
    settings: {
      'GET /settings': 'Get all settings (secrets masked)',
      'PUT /settings/:key': 'Update setting (admin)',
      'DELETE /settings/:key': 'Reset setting to default (admin)',
      'POST /settings/test-connection': 'Test authority API connection (admin)',
    },
    patchclass: {
      'GET /patchclass': 'List all patchclasses',
      'POST /patchclass': 'Create patchclass (admin)',
      'GET /patchclass/:name': 'Get patchclass detail',
      'DELETE /patchclass/:name': 'Delete patchclass (admin)',
      'GET /patchclass/:name/driver-map': 'Get driver map',
      'PUT /patchclass/:name/driver-map': 'Update driver map (admin)',
      'GET /patchclass/:name/driver-sets': 'List driver sets',
      'POST /patchclass/:name/driver-sets': 'Create driver set (admin)',
      'DELETE /patchclass/:name/driver-sets/:set': 'Delete driver set (admin)',
      'GET /patchclass/:name/driver-sets/:set/files': 'List files in set',
      'POST /patchclass/:name/driver-sets/:set/upload': 'Upload file (admin)',
      'POST /patchclass/:name/driver-sets/:set/extract': 'Extract ZIP (admin)',
      'POST /patchclass/:name/deploy-postsync/:image': 'Deploy postsync (admin)',
    },
  };

  const standaloneEndpoints = {
    hosts: {
      'GET /hosts': 'List hosts with pagination and filters',
      'GET /hosts/:id': 'Get host by ID',
      'GET /hosts/by-name/:hostname': 'Get host by hostname',
      'GET /hosts/by-mac/:mac': 'Get host by MAC address',
      'POST /hosts': 'Create new host',
      'PATCH /hosts/:id': 'Update host',
      'DELETE /hosts/:id': 'Delete host',
      'POST /hosts/:id/wake-on-lan': 'Send Wake-on-LAN',
      'POST /hosts/:id/sync': 'Start sync operation',
      'POST /hosts/:id/start': 'Start OS on host',
      'PATCH /hosts/:id/status': 'Update host status',
    },
    rooms: {
      'GET /rooms': 'List all rooms',
      'GET /rooms/:id': 'Get room with hosts',
      'POST /rooms': 'Create room',
      'PATCH /rooms/:id': 'Update room',
      'DELETE /rooms/:id': 'Delete room',
      'POST /rooms/:id/wake-all': 'Wake all hosts in room',
      'POST /rooms/:id/shutdown-all': 'Shutdown all hosts in room',
    },
    configs: {
      'GET /configs': 'List all configurations',
      'GET /configs/:id': 'Get config with partitions and OS',
      'GET /configs/:id/preview': 'Preview as start.conf',
      'POST /configs': 'Create configuration',
      'PATCH /configs/:id': 'Update configuration',
      'DELETE /configs/:id': 'Delete configuration',
      'POST /configs/:id/clone': 'Clone configuration',
      'POST /configs/:id/deploy': 'Deploy config to /srv/linbo',
      'POST /configs/:id/wake-all': 'Wake all hosts using this config',
      'GET /configs/deployed/list': 'List deployed configs',
      'POST /configs/deploy-all': 'Deploy all active configs',
      'POST /configs/cleanup-symlinks': 'Remove orphaned symlinks',
    },
    operations: {
      'GET /operations': 'List operations',
      'GET /operations/:id': 'Get operation with sessions',
      'POST /operations': 'Create operation',
      'POST /operations/send-command': 'Send command to hosts',
      'PATCH /operations/:id': 'Update operation',
      'POST /operations/:id/cancel': 'Cancel operation',
      'GET /operations/provision': 'List provisioning jobs',
      'GET /operations/provision/:id': 'Get provisioning operation',
      'POST /operations/provision': 'Manually trigger provisioning',
      'POST /operations/provision/:id/retry': 'Retry failed provision job',
    },
    stats: {
      'GET /stats/overview': 'Dashboard statistics',
      'GET /stats/hosts': 'Host statistics',
      'GET /stats/operations': 'Operation statistics',
      'GET /stats/images': 'Image storage statistics',
      'GET /stats/audit': 'Audit log statistics',
    },
    dhcp: {
      'GET /dhcp/network-settings': 'Get network settings',
      'PUT /dhcp/network-settings': 'Update network settings (admin)',
      'GET /dhcp/summary': 'DHCP export summary and stale status',
      'GET /dhcp/export/isc-dhcp': 'Export ISC DHCP config',
      'GET /dhcp/export/dnsmasq': 'Export dnsmasq full config',
      'GET /dhcp/export/dnsmasq-proxy': 'Export dnsmasq proxy config',
      'POST /dhcp/reload-proxy': 'Reload dnsmasq proxy container',
    },
  };

  const syncModeEndpoints = {
    operations: {
      'GET /operations': 'List operations (Redis-based)',
      'GET /operations/:id': 'Get operation with sessions',
      'GET /operations/scheduled': 'List scheduled onboot commands',
      'POST /operations/validate-commands': 'Validate command string',
      'POST /operations/direct': 'Execute commands via SSH (admin)',
      'POST /operations/schedule': 'Schedule onboot commands (admin)',
      'DELETE /operations/scheduled/:hostname': 'Cancel scheduled command (admin)',
      'POST /operations/wake': 'Wake hosts via WoL (admin)',
      'POST /operations/:id/cancel': 'Cancel operation (admin)',
    },
  };

  const endpoints = isSyncMode
    ? { ...baseEndpoints, ...syncModeEndpoints }
    : { ...baseEndpoints, ...standaloneEndpoints };

  res.json({
    message: 'LINBO Docker API',
    version: 'v1',
    mode: isSyncMode ? 'sync' : 'standalone',
    endpoints,
    documentation: '/docs',
  });
});

module.exports = router;
