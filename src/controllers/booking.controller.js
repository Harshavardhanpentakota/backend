'use strict';

const Booking = require('../models/Booking');
const Room = require('../models/Room');
const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const {
  BOOKING_STATUS, ROOM_STATUS, PAYMENT_STATUS, CANCELLATION_POLICY, BOOKING_SOURCE,
} = require('../constants');
const { sendSuccess, sendError, paginationMeta } = require('../utils/response');
const {
  generateBookingId, generateInvoiceNumber, calculateNights, calculateRefund, addGST, parsePagination,
} = require('../utils/helpers');
const { sendEmail, bookingConfirmationEmail, cancellationEmail } = require('../utils/email');
const logger = require('../utils/logger');

// ── Helper: check room availability ──────────────────────────────────────────
const isRoomAvailable = async (roomId, checkIn, checkOut, excludeBookingId = null) => {
  const filter = {
    room: roomId,
    status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CHECKED_IN, BOOKING_STATUS.PENDING] },
    $or: [{ checkInDate: { $lt: checkOut }, checkOutDate: { $gt: checkIn } }],
  };
  if (excludeBookingId) filter._id = { $ne: excludeBookingId };
  const conflict = await Booking.findOne(filter);
  return !conflict;
};

// POST /api/bookings
const createBooking = async (req, res, next) => {
  try {
    const { roomId, checkInDate, checkOutDate, guests, specialRequests, paymentMethod } = req.body;

    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);

    const room = await Room.findById(roomId);
    if (!room || !room.isActive) return sendError(res, 404, 'Room not found');
    if (room.status === ROOM_STATUS.MAINTENANCE) {
      return sendError(res, 409, 'Room is currently under maintenance');
    }

    if (guests > room.capacity) {
      return sendError(res, 400, `Room capacity is ${room.capacity} guests`);
    }

    const available = await isRoomAvailable(roomId, checkIn, checkOut);
    if (!available) {
      return sendError(res, 409, 'Room is not available for the selected dates');
    }

    const nights = calculateNights(checkIn, checkOut);
    const baseAmount = room.price * nights;
    const { subtotal, tax, totalAmount } = addGST(baseAmount);

    const bookingId = generateBookingId();

    const booking = await Booking.create({
      bookingId,
      user: req.user._id,
      room: roomId,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      guests,
      nights,
      subtotal,
      tax,
      totalAmount,
      status: BOOKING_STATUS.CONFIRMED,
      source: BOOKING_SOURCE.ONLINE,
      specialRequests,
    });

    // Send confirmation email (non-blocking)
    try {
      const emailData = bookingConfirmationEmail(booking, req.user, room);
      await sendEmail(emailData);
    } catch (emailErr) {
      logger.warn(`Booking confirmation email failed: ${emailErr.message}`);
    }

    const populated = await booking.populate('room', 'roomNumber type price floor amenities');

    logger.info(`Booking created: ${bookingId} by user ${req.user._id}`);
    return sendSuccess(res, 201, 'Booking created successfully', populated);
  } catch (error) {
    next(error);
  }
};

// GET /api/bookings  (admin / receptionist see all; user sees own)
const getBookings = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { status, paymentStatus, from, to, search } = req.query;

    const filter = {};

    // Non-admin users only see their own bookings
    if (req.user.role === 'user') filter.user = req.user._id;

    if (status) {
      const statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
      filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
    }
    if (paymentStatus) filter.paymentStatus = paymentStatus;
    if (from || to) {
      filter.checkInDate = {};
      if (from) filter.checkInDate.$gte = new Date(from);
      if (to) filter.checkInDate.$lte = new Date(to);
    }
    if (search) {
      filter.$or = [
        { bookingId: { $regex: search, $options: 'i' } },
        { 'guestDetails.name': { $regex: search, $options: 'i' } },
        { 'guestDetails.phone': { $regex: search, $options: 'i' } },
      ];
    }

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate('user', 'name email phone')
        .populate('room', 'roomNumber type price floor')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Booking.countDocuments(filter),
    ]);

    return sendSuccess(res, 200, 'Bookings fetched', bookings, paginationMeta(total, page, limit));
  } catch (error) {
    next(error);
  }
};

// GET /api/bookings/:id
const getBookingById = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('user', 'name email phone')
      .populate('room', 'roomNumber type price floor amenities images');

    if (!booking) return sendError(res, 404, 'Booking not found');

    // Users can only view their own bookings
    if (req.user.role === 'user' && String(booking.user._id) !== String(req.user._id)) {
      return sendError(res, 403, 'Access denied');
    }

    return sendSuccess(res, 200, 'Booking fetched', booking);
  } catch (error) {
    next(error);
  }
};

// PUT /api/bookings/:id/cancel
const cancelBooking = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('user', 'name email');

    if (!booking) return sendError(res, 404, 'Booking not found');

    if (req.user.role === 'user' && String(booking.user._id) !== String(req.user._id)) {
      return sendError(res, 403, 'Access denied');
    }

    if ([BOOKING_STATUS.CANCELLED, BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CHECKED_OUT].includes(booking.status)) {
      return sendError(res, 409, `Booking cannot be cancelled — current status: ${booking.status}`);
    }

    const { refundAmount, refundPercentage } = calculateRefund(
      booking.totalAmount,
      booking.checkInDate,
      CANCELLATION_POLICY
    );

    booking.status = BOOKING_STATUS.CANCELLED;
    booking.cancellationDate = new Date();
    booking.cancellationReason = req.body.reason || 'Cancelled by user';
    booking.refundAmount = refundAmount;
    booking.paymentStatus = refundAmount > 0 ? PAYMENT_STATUS.REFUNDED : booking.paymentStatus;

    await booking.save();

    // Mark room available if it was set to reserved
    await Room.findByIdAndUpdate(booking.room, { status: ROOM_STATUS.AVAILABLE });

    // Update payment record
    await Payment.findOneAndUpdate(
      { booking: booking._id },
      { status: refundAmount > 0 ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PAID, refundAmount, refundDate: new Date() }
    );

    // Send cancellation email
    try {
      const emailData = cancellationEmail(booking, booking.user, refundAmount);
      await sendEmail(emailData);
    } catch (emailErr) {
      logger.warn(`Cancellation email failed: ${emailErr.message}`);
    }

    logger.info(`Booking cancelled: ${booking.bookingId} — refund: ₹${refundAmount}`);
    return sendSuccess(res, 200, 'Booking cancelled successfully', {
      bookingId: booking.bookingId,
      refundAmount,
      refundPercentage,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { createBooking, getBookings, getBookingById, cancelBooking };
