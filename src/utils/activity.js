'use strict';

const ActivityLog = require('../models/ActivityLog');
const logger = require('./logger');

/**
 * Logs an administrative activity and alerts admins if the activity is critical.
 */
const logActivity = async ({
  req,
  userId,
  userName,
  role,
  action,
  module: activityModule,
  entityId,
  entityType,
  description,
  previousData,
  newData,
}) => {
  try {
    let ip = '';
    let ua = '';

    if (req) {
      ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
      if (Array.isArray(ip)) ip = ip[0];
      ua = req.headers['user-agent'] || '';

      if (!userId && req.user) {
        userId = req.user._id;
        userName = req.user.name;
        role = req.user.role;
      }
    }

    const log = await ActivityLog.create({
      userId: userId || null,
      userName: userName || 'System',
      role: role || 'system',
      action,
      module: activityModule,
      entityId: entityId || null,
      entityType: entityType || null,
      description,
      previousData: previousData || null,
      newData: newData || null,
      ipAddress: ip,
      userAgent: ua,
    });

    // Determine if this is an important activity that requires an admin notification
    const importantActions = [
      'Room Type Price Updated',
      'Weekend Rate Updated',
      'Seasonal Pricing Updated',
      'Booking Cancelled',
      'Booking Rejected',
      'Room Status Changed',
      'Staff Deleted',
      'Staff Member Deleted',
      'Room Deleted',
    ];

    const isImportant =
      importantActions.includes(action) ||
      (action && action.toLowerCase().includes('price updated')) ||
      (action && action.toLowerCase().includes('cancelled')) ||
      (description && description.toLowerCase().includes('unavailable')) ||
      (description && description.toLowerCase().includes('maintenance'));

    if (isImportant) {
      // Dynamic require to avoid circular dependency
      const { createNotification } = require('./notification');
      await createNotification({
        recipientRole: 'admin',
        title: `Activity Alert: ${action}`,
        message: description,
        type: 'activity_alert',
        metadata: {
          activityLogId: log._id,
          module: activityModule,
          action,
        },
      });
    }

    return log;
  } catch (error) {
    logger.error(`Failed to log activity: ${error.message}`);
    return null;
  }
};

module.exports = {
  logActivity,
};
