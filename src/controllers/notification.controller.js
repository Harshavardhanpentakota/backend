'use strict';

const Notification = require('../models/Notification');
const User = require('../models/User');
const { verifyAccessToken } = require('../utils/jwt');
const { notificationEmitter } = require('../utils/notificationStream');

/**
 * Get paginated notifications for the authenticated user/role.
 */
const getNotifications = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const role = req.user.role;

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const query = {
      $or: [
        { recipientId: userId },
        { recipientRole: role },
      ],
    };

    const total = await Notification.countDocuments(query);
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      success: true,
      notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get unread notification count.
 */
const getUnreadCount = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const role = req.user.role;

    const count = await Notification.countDocuments({
      $or: [
        { recipientId: userId },
        { recipientRole: role },
      ],
      isRead: false,
    });

    res.status(200).json({
      success: true,
      count,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark a specific notification as read.
 */
const readNotification = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      {
        _id: req.params.id,
        $or: [
          { recipientId: req.user._id },
          { recipientRole: req.user.role },
        ],
      },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found or access denied',
      });
    }

    res.status(200).json({
      success: true,
      notification,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark all notifications for the user/role as read.
 */
const readAllNotifications = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const role = req.user.role;

    await Notification.updateMany(
      {
        $or: [
          { recipientId: userId },
          { recipientRole: role },
        ],
        isRead: false,
      },
      { isRead: true }
    );

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Real-time Server-Sent Events (SSE) notification stream.
 */
const streamNotifications = async (req, res) => {
  try {
    let token = req.query.token;
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token is required for stream',
      });
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Invalid access token',
      });
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token or inactive user',
      });
    }

    req.user = user;

    // Set headers for EventStream
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    res.write(': open\n\n');

    const keepAliveInterval = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 30000);

    const onNotification = (notification) => {
      const userId = req.user._id.toString();
      const userRole = req.user.role;

      let shouldDeliver = false;
      if (notification.recipientId && notification.recipientId.toString() === userId) {
        shouldDeliver = true;
      } else if (notification.recipientRole && notification.recipientRole === userRole) {
        shouldDeliver = true;
      }

      if (shouldDeliver) {
        res.write(`data: ${JSON.stringify(notification)}\n\n`);
      }
    };

    notificationEmitter.on('notification', onNotification);

    req.on('close', () => {
      clearInterval(keepAliveInterval);
      notificationEmitter.removeListener('notification', onNotification);
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to establish connection stream',
    });
  }
};

module.exports = {
  getNotifications,
  getUnreadCount,
  readNotification,
  readAllNotifications,
  streamNotifications,
};
