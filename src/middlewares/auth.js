'use strict';

const { verifyAccessToken } = require('../utils/jwt');
const User = require('../models/User');
const { sendError } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * Verify JWT and attach user to request.
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 401, 'Authentication required. Please provide a valid token.');
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return sendError(res, 401, 'Token has expired. Please log in again.');
      }
      return sendError(res, 401, 'Invalid token. Please log in again.');
    }

    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return sendError(res, 401, 'User belonging to this token no longer exists.');
    }

    if (!user.isActive) {
      return sendError(res, 403, 'Your account has been deactivated. Please contact support.');
    }

    req.user = user;
    next();
  } catch (error) {
    logger.error(`Auth middleware error: ${error.message}`);
    return sendError(res, 500, 'Internal server error during authentication.');
  }
};

/**
 * Authorize one or more roles.
 * Usage: authorize('admin', 'receptionist')
 */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    return sendError(res, 401, 'Authentication required.');
  }

  if (!roles.includes(req.user.role)) {
    return sendError(
      res,
      403,
      `Access denied. This route requires one of the following roles: ${roles.join(', ')}.`
    );
  }

  next();
};

/**
 * Optional auth — attaches user if token present but does not block if missing.
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.id).select('-password');
    if (user && user.isActive) req.user = user;
  } catch {
    // Ignore errors in optional auth
  }
  next();
};

module.exports = { authenticate, authorize, optionalAuth };
