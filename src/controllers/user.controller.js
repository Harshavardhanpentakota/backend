'use strict';

const User = require('../models/User');
const Booking = require('../models/Booking');
const { sendSuccess, sendError, paginationMeta } = require('../utils/response');
const { parsePagination } = require('../utils/helpers');

// GET /api/users/profile
const getProfile = async (req, res, next) => {
  try {
    return sendSuccess(res, 200, 'Profile fetched', req.user);
  } catch (error) {
    next(error);
  }
};

// PUT /api/users/profile
const updateProfile = async (req, res, next) => {
  try {
    const allowedFields = ['name', 'phone'];
    const updates = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    });

    return sendSuccess(res, 200, 'Profile updated successfully', user);
  } catch (error) {
    next(error);
  }
};

// GET /api/users/bookings  — current user's booking history
const getMyBookings = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { status } = req.query;

    const filter = { user: req.user._id };
    if (status) filter.status = status;

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate('room', 'roomNumber type price images floor')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Booking.countDocuments(filter),
    ]);

    return sendSuccess(
      res,
      200,
      'Bookings fetched',
      bookings,
      paginationMeta(total, page, limit)
    );
  } catch (error) {
    next(error);
  }
};

// ── Admin: manage users ───────────────────────────────────────────────────────

// GET /api/users  (admin)
const getAllUsers = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { role, search, isActive } = req.query;

    const filter = {};
    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    return sendSuccess(res, 200, 'Users fetched', users, paginationMeta(total, page, limit));
  } catch (error) {
    next(error);
  }
};

// GET /api/users/:id  (admin)
const getUserById = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return sendError(res, 404, 'User not found');
    return sendSuccess(res, 200, 'User fetched', user);
  } catch (error) {
    next(error);
  }
};

// PATCH /api/users/:id/status  (admin)
const toggleUserStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return sendError(res, 404, 'User not found');

    user.isActive = !user.isActive;
    await user.save({ validateBeforeSave: false });

    return sendSuccess(
      res,
      200,
      `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      { isActive: user.isActive }
    );
  } catch (error) {
    next(error);
  }
};

module.exports = { getProfile, updateProfile, getMyBookings, getAllUsers, getUserById, toggleUserStatus };
