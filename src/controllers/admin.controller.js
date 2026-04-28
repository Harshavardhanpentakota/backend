'use strict';

const bcrypt = require('bcryptjs');
const Booking = require('../models/Booking');
const Room = require('../models/Room');
const User = require('../models/User');
const Payment = require('../models/Payment');
const Staff = require('../models/Staff');
const HotelSettings = require('../models/HotelSettings');
const { sendSuccess, sendError } = require('../utils/response');
const { parsePagination } = require('../utils/helpers');
const { BOOKING_STATUS, ROOM_STATUS, PAYMENT_STATUS, STAFF_ROLES, SHIFT, ROLES } = require('../constants');

// GET /api/admin/dashboard
const getDashboard = async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      totalRooms,
      occupiedRooms,
      availableRooms,
      maintenanceRooms,
      totalBookings,
      todayCheckIns,
      todayCheckOuts,
      pendingBookings,
      confirmedBookings,
      totalUsers,
      totalStaff,
      revenueResult,
      monthlyRevenue,
      recentBookings,
    ] = await Promise.all([
      Room.countDocuments({ isActive: true }),
      Room.countDocuments({ status: ROOM_STATUS.OCCUPIED, isActive: true }),
      Room.countDocuments({ status: ROOM_STATUS.AVAILABLE, isActive: true }),
      Room.countDocuments({ status: ROOM_STATUS.MAINTENANCE, isActive: true }),
      Booking.countDocuments(),
      Booking.countDocuments({ checkInDate: { $gte: today, $lt: tomorrow } }),
      Booking.countDocuments({ checkOutDate: { $gte: today, $lt: tomorrow } }),
      Booking.countDocuments({ status: BOOKING_STATUS.PENDING }),
      Booking.countDocuments({ status: BOOKING_STATUS.CONFIRMED }),
      User.countDocuments({ role: 'user', isActive: true }),
      Staff.countDocuments({ isActive: true }),
      Payment.aggregate([
        { $match: { status: PAYMENT_STATUS.PAID } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Payment.aggregate([
        {
          $match: {
            status: PAYMENT_STATUS.PAID,
            paidAt: {
              $gte: new Date(today.getFullYear(), today.getMonth(), 1),
              $lt: new Date(today.getFullYear(), today.getMonth() + 1, 1),
            },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Booking.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('user', 'name email')
        .populate('room', 'roomNumber type'),
    ]);

    const totalRevenue = revenueResult[0]?.total || 0;
    const currentMonthRevenue = monthlyRevenue[0]?.total || 0;
    const occupancyRate = totalRooms > 0 ? ((occupiedRooms / totalRooms) * 100).toFixed(1) : 0;

    return sendSuccess(res, 200, 'Dashboard data fetched', {
      rooms: { total: totalRooms, occupied: occupiedRooms, available: availableRooms, maintenance: maintenanceRooms },
      bookings: { total: totalBookings, todayCheckIns, todayCheckOuts, pending: pendingBookings, confirmed: confirmedBookings },
      users: { total: totalUsers },
      staff: { total: totalStaff },
      revenue: { allTime: totalRevenue, currentMonth: currentMonthRevenue },
      occupancyRate: parseFloat(occupancyRate),
      recentBookings,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/admin/reports/revenue  — monthly revenue for the past N months
const getRevenueReport = async (req, res, next) => {
  try {
    const months = parseInt(req.query.months, 10) || 6;

    const result = await Payment.aggregate([
      { $match: { status: PAYMENT_STATUS.PAID } },
      {
        $group: {
          _id: {
            year: { $year: '$paidAt' },
            month: { $month: '$paidAt' },
          },
          revenue: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: months },
    ]);

    return sendSuccess(res, 200, 'Revenue report fetched', result.reverse());
  } catch (error) {
    next(error);
  }
};

// GET /api/admin/reports/occupancy
const getOccupancyReport = async (req, res, next) => {
  try {
    const months = parseInt(req.query.months, 10) || 6;

    const result = await Booking.aggregate([
      {
        $match: {
          status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CHECKED_IN, BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CHECKED_OUT] },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$checkInDate' },
            month: { $month: '$checkInDate' },
          },
          bookings: { $sum: 1 },
          totalNights: { $sum: '$nights' },
        },
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: months },
    ]);

    return sendSuccess(res, 200, 'Occupancy report fetched', result.reverse());
  } catch (error) {
    next(error);
  }
};

// GET /api/admin/reports/bookings-by-room-type
const getBookingsByRoomType = async (req, res, next) => {
  try {
    const result = await Booking.aggregate([
      {
        $lookup: {
          from: 'rooms',
          localField: 'room',
          foreignField: '_id',
          as: 'roomData',
        },
      },
      { $unwind: '$roomData' },
      {
        $group: {
          _id: '$roomData.type',
          count: { $sum: 1 },
          revenue: { $sum: '$totalAmount' },
        },
      },
      { $sort: { count: -1 } },
    ]);

    return sendSuccess(res, 200, 'Bookings by room type fetched', result);
  } catch (error) {
    next(error);
  }
};

// ── Staff ─────────────────────────────────────────────────────────────────────

// GET /api/admin/staff
const getStaff = async (req, res, next) => {
  try {
    const staff = await Staff.find().sort({ createdAt: -1 });
    return sendSuccess(res, 200, 'Staff fetched', staff);
  } catch (error) { next(error); }
};

// POST /api/admin/staff
const createStaff = async (req, res, next) => {
  try {
    const { name, role, shift, salary, contact, notes } = req.body;
    if (!name || !role || !shift) return sendError(res, 400, 'name, role and shift are required');
    const count = await Staff.countDocuments();
    const staff = await Staff.create({
      employeeId: `EMP-${String(count + 1).padStart(4, '0')}`,
      name, role, shift, salary, contact, notes,
    });
    return sendSuccess(res, 201, 'Staff created', staff);
  } catch (error) { next(error); }
};

// PATCH /api/admin/staff/:id
const updateStaff = async (req, res, next) => {
  try {
    const staff = await Staff.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!staff) return sendError(res, 404, 'Staff not found');
    return sendSuccess(res, 200, 'Staff updated', staff);
  } catch (error) { next(error); }
};

// DELETE /api/admin/staff/:id  — soft delete
const deleteStaff = async (req, res, next) => {
  try {
    const staff = await Staff.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!staff) return sendError(res, 404, 'Staff not found');
    return sendSuccess(res, 200, 'Staff deactivated');
  } catch (error) { next(error); }
};

// ── Users ─────────────────────────────────────────────────────────────────────

// GET /api/admin/users?search=&role=&page=&limit=
const getUsers = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { search, role } = req.query;
    const filter = {};
    if (role) filter.role = role;
    else filter.role = { $in: ['user', 'receptionist', 'admin'] };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }
    const [users, total] = await Promise.all([
      User.find(filter).select('-password -refreshTokens').sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);
    return sendSuccess(res, 200, 'Users fetched', users, { total, page, limit });
  } catch (error) { next(error); }
};

// ── Bookings ──────────────────────────────────────────────────────────────────

// PATCH /api/admin/bookings/:id/status
const updateBookingStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowed = Object.values(require('../constants').BOOKING_STATUS);
    if (!allowed.includes(status)) return sendError(res, 400, 'Invalid status');
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).populate('room', 'roomNumber type').populate('user', 'name email');
    if (!booking) return sendError(res, 404, 'Booking not found');
    return sendSuccess(res, 200, 'Booking status updated', booking);
  } catch (error) { next(error); }
};

// ── Rooms (admin) ─────────────────────────────────────────────────────────────

// GET /api/admin/rooms
const getRoomsAdmin = async (req, res, next) => {
  try {
    const rooms = await Room.find({ isActive: true }).sort({ floor: 1, roomNumber: 1 });
    return sendSuccess(res, 200, 'Rooms fetched', rooms);
  } catch (error) { next(error); }
};

// PATCH /api/admin/rooms/:id — full room edit (price, amenities, description, status, etc.)
const updateRoomAdmin = async (req, res, next) => {
  try {
    const allowed = ['price', 'status', 'description', 'amenities', 'beds', 'size', 'capacity', 'isActive'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    const room = await Room.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!room) return sendError(res, 404, 'Room not found');
    return sendSuccess(res, 200, 'Room updated', room);
  } catch (error) { next(error); }
};

// ── Hotel Settings (admin) ────────────────────────────────────────────────────

// GET /api/admin/settings
const getSettings = async (req, res, next) => {
  try {
    const settings = await HotelSettings.getSettings();
    return sendSuccess(res, 200, 'Settings fetched', settings);
  } catch (error) { next(error); }
};

// PATCH /api/admin/settings
const updateSettings = async (req, res, next) => {
  try {
    const allowed = [
      'cgstPercentage', 'sgstPercentage', 'advancePaymentPercent',
      'hotelName', 'hotelPhone', 'hotelEmail', 'hotelAddress', 'hotelTagline', 'gstNumber',
    ];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    const settings = await HotelSettings.findByIdAndUpdate('default', update, {
      new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true,
    });
    return sendSuccess(res, 200, 'Settings updated', settings);
  } catch (error) { next(error); }
};

module.exports = {
  getDashboard,
  getRevenueReport,
  getOccupancyReport,
  getBookingsByRoomType,
  // Staff
  getStaff, createStaff, updateStaff, deleteStaff,
  // Users
  getUsers,
  // Bookings
  updateBookingStatus,
  // Rooms
  getRoomsAdmin, updateRoomAdmin,
  // Settings
  getSettings, updateSettings,
};
