'use strict';

const express = require('express');
const router = express.Router();
const {
  getNotifications,
  getUnreadCount,
  readNotification,
  readAllNotifications,
  streamNotifications,
} = require('../controllers/notification.controller');
const { authenticate } = require('../middlewares/auth');

// Stream endpoint handles internal authentication from header or query token
router.get('/stream', streamNotifications);

router.get('/', authenticate, getNotifications);
router.get('/unread-count', authenticate, getUnreadCount);
router.patch('/read-all', authenticate, readAllNotifications);
router.patch('/:id/read', authenticate, readNotification);

module.exports = router;
