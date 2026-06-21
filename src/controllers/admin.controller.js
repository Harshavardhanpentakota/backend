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
const ActivityLog = require('../models/ActivityLog');
const { logActivity } = require('../utils/activity');
const { createNotification } = require('../utils/notification');

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
      recentActivities,
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
      // Revenue from paid Payment records (matches what Payments page shows)
      Payment.aggregate([
        { $match: { status: PAYMENT_STATUS.PAID } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      // Monthly revenue (current month) from paid Payment records
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
      ActivityLog.find()
        .sort({ createdAt: -1 })
        .limit(10),
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
      recentActivities,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/admin/reports/revenue  — monthly revenue for the past N months
const getRevenueReport = async (req, res, next) => {
  try {
    const months = parseInt(req.query.months, 10) || 6;

    const result = await Booking.aggregate([
      { $match: { status: { $in: [BOOKING_STATUS.CHECKED_OUT, BOOKING_STATUS.COMPLETED] } } },
      {
        $group: {
          _id: {
            year: { $year: '$checkOutDate' },
            month: { $month: '$checkOutDate' },
          },
          revenue: { $sum: '$totalAmount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: months },
    ]);

    const months_names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const formatted = result.reverse().map((r) => ({
      month: `${months_names[r._id.month - 1]} ${r._id.year}`,
      revenue: r.revenue,
      count: r.count,
    }));

    return sendSuccess(res, 200, 'Revenue report fetched', formatted);
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
    const staff = await Staff.findByIdAndUpdate(req.params.id, { isDeleted: true, isActive: false }, { new: true });
    if (!staff) return sendError(res, 404, 'Staff not found');
    return sendSuccess(res, 200, 'Staff deleted successfully');
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
    const allowed = ['roomNumber', 'floor', 'type', 'price', 'status', 'description', 'amenities', 'beds', 'size', 'capacity', 'isActive', 'customPrice'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    // Handle resetting customPrice to default
    if (req.body.customPrice === null || req.body.customPrice === "") {
      update.$unset = { customPrice: 1 };
      delete update.customPrice;
    }
    const room = await Room.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!room) return sendError(res, 404, 'Room not found');
    return sendSuccess(res, 200, 'Room updated', room);
  } catch (error) { next(error); }
};

// ── Hotel Settings (admin) ────────────────────────────────────────────────────

// GET /api/admin/active-guests — all currently checked-in bookings
const getActiveGuests = async (req, res, next) => {
  try {
    const bookings = await Booking.find({ status: BOOKING_STATUS.CHECKED_IN })
      .populate('room', 'roomNumber type floor price')
      .populate('user', 'name email phone')
      .sort({ actualCheckIn: -1 });
    return sendSuccess(res, 200, 'Active guests fetched', bookings);
  } catch (error) { next(error); }
};

// PATCH /api/admin/bookings/:id/change-room — move guest to a different room
const changeGuestRoom = async (req, res, next) => {
  try {
    const { newRoomId } = req.body;
    if (!newRoomId) return sendError(res, 400, 'newRoomId is required');

    const booking = await Booking.findById(req.params.id).populate('room');
    if (!booking) return sendError(res, 404, 'Booking not found');
    if (booking.status !== BOOKING_STATUS.CHECKED_IN) {
      return sendError(res, 409, 'Can only change room for checked-in guests');
    }

    const newRoom = await Room.findById(newRoomId);
    if (!newRoom || !newRoom.isActive) return sendError(res, 404, 'New room not found');
    if (newRoom.status !== ROOM_STATUS.AVAILABLE) {
      return sendError(res, 409, `Room ${newRoom.roomNumber} is not available (status: ${newRoom.status})`);
    }

    const oldRoomId = booking.room._id;

    // Recalculate subtotal with new room price
    const nights = booking.nights;
    const effectivePrice = newRoom.customPrice ?? newRoom.price;
    const newSubtotal = effectivePrice * nights;
    const settings = await HotelSettings.getSettings();
    const cgst = Math.round(newSubtotal * settings.cgstPercentage) / 100;
    const sgst = Math.round(newSubtotal * settings.sgstPercentage) / 100;
    const tax = cgst + sgst;
    const totalAmount = newSubtotal + tax + (booking.extraCharges || []).reduce((s, c) => s + c.amount, 0);

    booking.room = newRoomId;
    booking.pricePerNight = effectivePrice;
    booking.subtotal = newSubtotal;
    booking.tax = tax;
    booking.totalAmount = totalAmount;
    await booking.save();

    // Free old room, occupy new room
    await Room.findByIdAndUpdate(oldRoomId, { status: ROOM_STATUS.AVAILABLE });
    await Room.findByIdAndUpdate(newRoomId, { status: ROOM_STATUS.OCCUPIED });

    const updated = await Booking.findById(booking._id)
      .populate('room', 'roomNumber type floor price')
      .populate('user', 'name email phone');

    return sendSuccess(res, 200, `Guest moved to Room ${newRoom.roomNumber}`, updated);
  } catch (error) { next(error); }
};

const updateRoomPricing = async (req, res, next) => {
  try {
    const { pricing } = req.body;
    if (!pricing || typeof pricing !== 'object') {
      return sendError(res, 400, 'pricing object is required');
    }

    const types = Object.keys(pricing);
    
    // Fetch previous rates for change history logging
    const prevRooms = await Room.find({ type: { $in: types } });
    const previousPricing = {};
    prevRooms.forEach((r) => {
      previousPricing[r.type] = r.price;
    });

    const updatePromises = types.map((type) => {
      const price = Number(pricing[type]);
      if (isNaN(price) || price < 0) {
        throw new Error(`Invalid price for type ${type}`);
      }
      return Room.updateMany({ type }, { price });
    });

    await Promise.all(updatePromises);

    // Log the action to Activity History
    const previousRatesFormatted = Object.keys(previousPricing)
      .map((t) => `${t}: ₹${previousPricing[t]}`)
      .join(', ');
    const newRatesFormatted = Object.keys(pricing)
      .map((t) => `${t}: ₹${pricing[t]}`)
      .join(', ');

    await logActivity({
      req,
      action: 'Room Type Price Updated',
      module: 'Pricing',
      description: `Room type pricing updated. previous: [${previousRatesFormatted}] -> current: [${newRatesFormatted}]`,
      previousData: previousPricing,
      newData: pricing,
    });

    const logger = require('../utils/logger');
    logger.info(`Admin updated room pricing: ${JSON.stringify(pricing)}`);
    return sendSuccess(res, 200, 'Room pricing updated successfully');
  } catch (error) {
    next(error);
  }
};

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
    
    const oldSettings = await HotelSettings.findOne({ _id: 'default' });

    const settings = await HotelSettings.findByIdAndUpdate('default', update, {
      new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true,
    });

    await logActivity({
      req,
      action: 'Configuration Changed',
      module: 'Settings',
      description: `System settings updated: ${Object.keys(update).join(', ')}`,
      previousData: oldSettings ? oldSettings.toObject() : null,
      newData: settings.toObject(),
    });

    return sendSuccess(res, 200, 'Settings updated', settings);
  } catch (error) { next(error); }
};

const getActivityLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, module: mod, role, action, user, from, to, search } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const filter = {};

    if (mod) filter.module = mod;
    if (role) filter.role = role;
    if (action) filter.action = action;
    if (user) filter.userId = user;

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) {
        const endDate = new Date(to);
        endDate.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = endDate;
      }
    }

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      filter.$or = [
        { userName: searchRegex },
        { description: searchRegex },
        { action: searchRegex },
        { module: searchRegex },
        { entityId: searchRegex }
      ];
    }

    const [logs, total] = await Promise.all([
      ActivityLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10)),
      ActivityLog.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      logs,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        pages: Math.ceil(total / parseInt(limit, 10))
      }
    });
  } catch (error) {
    next(error);
  }
};

const exportActivityLogs = async (req, res, next) => {
  try {
    const { format = 'csv', module: mod, role, action, user, from, to, search } = req.query;

    const filter = {};
    if (mod) filter.module = mod;
    if (role) filter.role = role;
    if (action) filter.action = action;
    if (user) filter.userId = user;

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) {
        const endDate = new Date(to);
        endDate.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = endDate;
      }
    }

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      filter.$or = [
        { userName: searchRegex },
        { description: searchRegex },
        { action: searchRegex },
        { module: searchRegex },
        { entityId: searchRegex }
      ];
    }

    const logs = await ActivityLog.find(filter).sort({ createdAt: -1 });

    if (format === 'pdf') {
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ margin: 30, size: 'A4' });
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="activity_logs.pdf"');
      doc.pipe(res);

      doc.fontSize(18).text('Activity History / Audit Trail', { align: 'center' });
      doc.fontSize(10).text(`Generated at: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.moveDown();

      logs.forEach((log, index) => {
        doc.fontSize(10).font('Helvetica-Bold').text(`${index + 1}. [${new Date(log.createdAt).toLocaleString('en-IN')}] - ${log.userName} (${log.role.toUpperCase()})`);
        doc.font('Helvetica').fontSize(9)
          .text(`Module: ${log.module} | Action: ${log.action}`)
          .text(`Description: ${log.description}`);
        
        if (log.previousData || log.newData) {
          doc.text(`Details: ${JSON.stringify({ previous: log.previousData, current: log.newData })}`, { width: 500 });
        }
        doc.moveDown(0.5);
      });

      doc.end();
    } else {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="activity_logs.csv"');

      let csvContent = 'Date/Time,User,Role,Module,Action,Description,IP Address\n';

      logs.forEach(log => {
        const row = [
          new Date(log.createdAt).toISOString(),
          `"${log.userName.replace(/"/g, '""')}"`,
          `"${log.role.replace(/"/g, '""')}"`,
          `"${log.module.replace(/"/g, '""')}"`,
          `"${log.action.replace(/"/g, '""')}"`,
          `"${log.description.replace(/"/g, '""')}"`,
          `"${(log.ipAddress || '').replace(/"/g, '""')}"`
        ];
        csvContent += row.join(',') + '\n';
      });

      res.status(200).send(csvContent);
    }
  } catch (error) {
    next(error);
  }
};

// PATCH /api/admin/users/:id/password
const changeUserPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password || password.length < 8) {
      return sendError(res, 400, 'Password must be at least 8 characters long.');
    }

    const user = await User.findById(id);
    if (!user) {
      return sendError(res, 404, 'User not found.');
    }

    user.password = password;
    await user.save();

    await logActivity({
      req,
      action: 'User Password Changed by Admin',
      module: 'User Management',
      entityId: user._id.toString(),
      entityType: 'User',
      description: `Admin changed password for guest ${user.name} (${user.email || user.phone || 'N/A'}).`
    });

    const logger = require('../utils/logger');
    logger.info(`Admin changed password for user: ${user._id}`);
    return sendSuccess(res, 200, `Password for ${user.name} has been updated successfully.`);
  } catch (error) {
    next(error);
  }
};

const deleteBooking = async (req, res, next) => {
  try {
    const { id } = req.params;
    const mongoose = require('mongoose');
    const bookingObjectId = new mongoose.Types.ObjectId(id);

    const booking = await Booking.findById(id);
    if (!booking) return sendError(res, 404, 'Booking not found');

    if (booking.room) {
      await Room.findByIdAndUpdate(booking.room, { status: ROOM_STATUS.AVAILABLE });
    }

    if (booking.user) {
      await User.findByIdAndUpdate(booking.user, { isDeleted: true });
    }

    await Payment.updateMany({ booking: bookingObjectId }, { isDeleted: true });

    const Invoice = require('../models/Invoice');
    await Invoice.updateMany({ booking: bookingObjectId }, { isDeleted: true });

    await Booking.findByIdAndUpdate(id, { isDeleted: true });

    await logActivity({
      req,
      action: 'Booking Deleted',
      module: 'Bookings',
      entityId: id,
      entityType: 'Booking',
      description: `Admin deleted booking #${booking.bookingId} and associated user, payments, and invoices.`
    });

    return sendSuccess(res, 200, 'Booking deleted successfully');
  } catch (error) {
    next(error);
  }
};

const deletePayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const payment = await Payment.findById(id);
    if (!payment) return sendError(res, 404, 'Payment not found');

    await Payment.findByIdAndUpdate(id, { isDeleted: true });

    await logActivity({
      req,
      action: 'Payment Deleted',
      module: 'Payments',
      entityId: id,
      entityType: 'Payment',
      description: `Admin deleted payment of ₹${payment.amount} (Txn: ${payment.transactionId || 'N/A'})`
    });

    return sendSuccess(res, 200, 'Payment deleted successfully');
  } catch (error) {
    next(error);
  }
};

const deleteInvoice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const Invoice = require('../models/Invoice');
    const Booking = require('../models/Booking');
    const { BOOKING_STATUS } = require('../constants');

    const invoice = await Invoice.findById(id);
    if (!invoice) return sendError(res, 404, 'Invoice not found');

    const booking = await Booking.findById(invoice.booking);
    if (booking && booking.status === BOOKING_STATUS.CHECKED_IN) {
      return sendError(res, 400, 'Guest is in stay, cannot delete the invoice');
    }

    await Invoice.findByIdAndUpdate(id, { isDeleted: true });

    await logActivity({
      req,
      action: 'Invoice Deleted',
      module: 'Invoices',
      entityId: id,
      entityType: 'Invoice',
      description: `Admin deleted invoice #${invoice.invoiceNumber}`
    });

    return sendSuccess(res, 200, 'Invoice deleted successfully');
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return sendError(res, 404, 'User not found');

    await User.findByIdAndUpdate(id, { isDeleted: true });

    await logActivity({
      req,
      action: 'User Deleted',
      module: 'User Management',
      entityId: id,
      entityType: 'User',
      description: `Admin deleted guest/user ${user.name} (${user.email || user.phone})`
    });

    return sendSuccess(res, 200, 'User deleted successfully');
  } catch (error) {
    next(error);
  }
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
  changeUserPassword,
  deleteUser,
  // Bookings
  updateBookingStatus,
  deleteBooking,
  // Rooms
  getRoomsAdmin, updateRoomAdmin, updateRoomPricing,
  // Active guests + room change
  getActiveGuests, changeGuestRoom,
  // Settings
  getSettings, updateSettings,
  // Activity history
  getActivityLogs, exportActivityLogs,
  // Deletions
  deletePayment,
  deleteInvoice,
};
