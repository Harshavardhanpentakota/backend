'use strict';

const User = require('../models/User');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { sendSuccess, sendError } = require('../utils/response');
const logger = require('../utils/logger');
const { logActivity } = require('../utils/activity');

const normalizePhone = (phone) => {
  if (!phone) return phone;
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits;
};

// POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { name, email, password, phone } = req.body;
    const normalizedPhone = normalizePhone(phone);

    // Check phone uniqueness
    const existingPhone = await User.findOne({ phone: normalizedPhone });
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

    const user = await User.create({ name, email: email || undefined, password, phone: normalizedPhone });

    const accessToken = generateAccessToken({ id: user._id, role: user.role });
    const refreshToken = generateRefreshToken({ id: user._id });

    user.refreshToken = refreshToken;
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    logger.info(`New user registered: ${normalizedPhone}${email ? ' / ' + email : ''}`);

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
    const query = isEmail ? { email: rawId } : { phone: normalizePhone(rawId) };

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

// POST /api/auth/forgot-password
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return sendError(res, 400, 'Email is required.');
    }

    const user = await User.findOne({ email });
    if (!user) {
      return sendError(res, 404, 'No account found with this email address.');
    }

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store in User document with 10-minute expiry
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    // Send email with OTP
    try {
      const { sendEmail, otpEmail } = require('../utils/email');
      const emailData = otpEmail(otp, user);
      await sendEmail(emailData);
    } catch (emailErr) {
      logger.error(`Failed to send password reset OTP email to ${email}: ${emailErr.message}`);
      return sendError(res, 500, 'Failed to send OTP to email. Please try again later.');
    }

    logger.info(`OTP generated and sent to ${email}`);
    return sendSuccess(res, 200, 'OTP sent to your email successfully.');
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/reset-password
const resetPassword = async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return sendError(res, 400, 'Email, OTP, and new password are required.');
    }
    if (newPassword.length < 8) {
      return sendError(res, 400, 'New password must be at least 8 characters long.');
    }

    const user = await User.findOne({ email }).select('+password +otp +otpExpires');
    if (!user) {
      return sendError(res, 404, 'No account found with this email address.');
    }

    // Verify OTP
    if (!user.otp || !user.otpExpires || user.otp !== otp || user.otpExpires < new Date()) {
      return sendError(res, 400, 'Invalid or expired OTP.');
    }

    // Update password, clear OTP
    user.password = newPassword;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    await logActivity({
      req,
      userId: user._id,
      userName: user.name,
      role: user.role,
      action: 'Password Reset',
      module: 'Authentication',
      description: `Password reset via OTP verification for ${user.email}.`
    });

    logger.info(`Password successfully reset for user: ${email}`);
    return sendSuccess(res, 200, 'Password has been reset successfully. You can now login.');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  refreshToken,
  logout,
  getMe,
  changePassword,
  forgotPassword,
  resetPassword,
};
