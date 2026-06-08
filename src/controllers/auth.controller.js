'use strict';

const User = require('../models/User');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { sendSuccess, sendError } = require('../utils/response');
const logger = require('../utils/logger');
const { logActivity } = require('../utils/activity');

// POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { name, email, password, phone } = req.body;

    // Check phone uniqueness
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return sendError(res, 409, 'An account with this phone number already exists.');
    }

    // Check email uniqueness only if provided
    if (email) {
      const existingEmail = await User.findOne({ email });
      if (existingEmail) {
        return sendError(res, 409, 'An account with this email already exists.');
      }
    }

    const user = await User.create({ name, email: email || undefined, password, phone });

    const accessToken = generateAccessToken({ id: user._id, role: user.role });
    const refreshToken = generateRefreshToken({ id: user._id });

    user.refreshToken = refreshToken;
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    logger.info(`New user registered: ${phone}${email ? ' / ' + email : ''}`);

    return sendSuccess(res, 201, 'Registration successful', {
      user,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/login
const login = async (req, res, next) => {
  try {
    // Accept phone, email, or a generic identifier field
    const { identifier, phone, email, password } = req.body;
    const rawId = (identifier || phone || email || '').trim();

    // Determine if identifier looks like a phone or email
    const isEmail = rawId.includes('@');
    const query = isEmail ? { email: rawId } : { phone: rawId };

    const user = await User.findOne(query).select('+password');
    if (!user) {
      return sendError(res, 401, 'Invalid credentials.');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return sendError(res, 401, 'Invalid credentials.');
    }

    if (!user.isActive) {
      return sendError(res, 403, 'Your account has been deactivated. Please contact support.');
    }

    const accessToken = generateAccessToken({ id: user._id, role: user.role });
    const refreshToken = generateRefreshToken({ id: user._id });

    user.refreshToken = refreshToken;
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    // Remove sensitive fields from response
    user.password = undefined;
    user.refreshToken = undefined;

    await logActivity({
      req,
      userId: user._id,
      userName: user.name,
      role: user.role,
      action: 'Login',
      module: 'Authentication',
      description: `${user.name} logged in successfully.`
    });

    logger.info(`User logged in: ${rawId}`);

    return sendSuccess(res, 200, 'Login successful', {
      user,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/refresh
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) {
      return sendError(res, 401, 'Refresh token is required.');
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch {
      return sendError(res, 401, 'Invalid or expired refresh token. Please log in again.');
    }

    const user = await User.findById(decoded.id).select('+refreshToken');
    if (!user || user.refreshToken !== token) {
      return sendError(res, 401, 'Refresh token is invalid or has been revoked.');
    }

    const newAccessToken = generateAccessToken({ id: user._id, role: user.role });
    const newRefreshToken = generateRefreshToken({ id: user._id });

    user.refreshToken = newRefreshToken;
    await user.save({ validateBeforeSave: false });

    return sendSuccess(res, 200, 'Token refreshed', {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/logout
const logout = async (req, res, next) => {
  try {
    await logActivity({
      req,
      action: 'Logout',
      module: 'Authentication',
      description: `${req.user.name} logged out.`
    });
    await User.findByIdAndUpdate(req.user._id, { $unset: { refreshToken: '' } });
    return sendSuccess(res, 200, 'Logged out successfully');
  } catch (error) {
    next(error);
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  return sendSuccess(res, 200, 'Current user fetched', req.user);
};

// PUT /api/auth/change-password
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+password');

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return sendError(res, 400, 'Current password is incorrect.');
    }

    user.password = newPassword;
    await user.save();

    await logActivity({
      req,
      action: 'Password Change',
      module: 'Authentication',
      description: `${req.user.name} changed password.`
    });

    logger.info(`Password changed for user: ${user.email}`);
    return sendSuccess(res, 200, 'Password changed successfully');
  } catch (error) {
    next(error);
  }
};

module.exports = { register, login, refreshToken, logout, getMe, changePassword };
