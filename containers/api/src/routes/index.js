/**
 * LINBO Docker - Route Aggregator
 * Combines all route modules
 */

const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth');
const hostRoutes = require('./hosts');
const groupRoutes = require('./groups');
const roomRoutes = require('./rooms');
const configRoutes = require('./configs');
const imageRoutes = require('./images');
const operationRoutes = require('./operations');
const statsRoutes = require('./stats');
const systemRoutes = require('./system');
const internalRoutes = require('./internal');

// Mount routes
router.use('/auth', authRoutes);
router.use('/hosts', hostRoutes);
router.use('/groups', groupRoutes);
router.use('/rooms', roomRoutes);
router.use('/configs', configRoutes);
router.use('/images', imageRoutes);
router.use('/operations', operationRoutes);
router.use('/stats', statsRoutes);
router.use('/system', systemRoutes);
router.use('/internal', internalRoutes);

// API info endpoint
router.get('/', (req, res) => {
  res.json({
    message: 'LINBO Docker API',
    version: 'v1',
    endpoints: {
      auth: {
        'POST /auth/login': 'Authenticate and get JWT token',
        'POST /auth/logout': 'Logout (invalidate token)',
        'GET /auth/me': 'Get current user info',
        'POST /auth/register': 'Create new user (admin only)',
        'PUT /auth/password': 'Change own password',
      },
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
      groups: {
        'GET /groups': 'List all groups',
        'GET /groups/:id': 'Get group with hosts',
        'POST /groups': 'Create group',
        'PATCH /groups/:id': 'Update group',
        'DELETE /groups/:id': 'Delete group',
        'POST /groups/:id/apply-config': 'Apply config to group',
        'POST /groups/:id/wake-all': 'Wake all hosts in group',
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
        'POST /configs/:id/apply-to-groups': 'Apply to groups',
        'POST /configs/:id/clone': 'Clone configuration',
        'POST /configs/:id/deploy': 'Deploy config to /srv/linbo',
        'GET /configs/deployed/list': 'List deployed configs',
        'POST /configs/deploy-all': 'Deploy all active configs',
        'POST /configs/cleanup-symlinks': 'Remove orphaned symlinks',
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
      operations: {
        'GET /operations': 'List operations',
        'GET /operations/:id': 'Get operation with sessions',
        'POST /operations': 'Create operation',
        'POST /operations/send-command': 'Send command to hosts',
        'PATCH /operations/:id': 'Update operation',
        'POST /operations/:id/cancel': 'Cancel operation',
      },
      stats: {
        'GET /stats/overview': 'Dashboard statistics',
        'GET /stats/hosts': 'Host statistics',
        'GET /stats/operations': 'Operation statistics',
        'GET /stats/images': 'Image storage statistics',
        'GET /stats/audit': 'Audit log statistics',
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
    },
    documentation: '/docs',
  });
});

module.exports = router;
