/**
 * LINBO Docker - System Routes Aggregator
 * Mounts all system sub-routers.
 */

const express = require('express');
const router = express.Router();

router.use('/', require('./linbofs'));
router.use('/', require('./kernel'));
router.use('/', require('./firmware'));
router.use('/', require('./wlan'));
router.use('/', require('./grub-theme'));
router.use('/', require('./grub-config'));
router.use('/', require('./worker'));
router.use('/', require('./linbo-update'));
router.use('/', require('./hooks'));

module.exports = router;
