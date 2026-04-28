'use strict';

const Booking = require('../models/Booking');
const Room = require('../models/Room');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const HotelSettings = require('../models/HotelSettings');
const {
  BOOKING_STATUS, ROOM_STATUS, BOOKING_SOURCE,
} = require('../constants');
const { sendSuccess, sendError } = require('../utils/response');
const {
  generateBookingId, generateInvoiceNumber, calculateNights,
} = require('../utils/helpers');
const logger = require('../utils/logger');

// ── Helpers ───────────────────────────────────────────────────────────────────

const populateBooking = (query) =>
  query
    .populate('room', 'roomNumber type floor price')
    .populate('user', 'name email phone')
    .populate('extraCharges.addedBy', 'name');

const buildInvoiceData = (booking, settings) => {
  const extraChargesTotal = (booking.extraCharges || []).reduce((s, c) => s + c.amount, 0);
  const subtotal = booking.subtotal + extraChargesTotal;
  const cgstPct = settings.cgstPercentage;
  const sgstPct = settings.sgstPercentage;
  const cgst = Math.round(subtotal * cgstPct) / 100;
  const sgst = Math.round(subtotal * sgstPct) / 100;
  const tax = cgst + sgst;
  const totalAmount = subtotal + tax;
  const advancePaid = booking.advancePaid || 0;
  const balanceDue = Math.max(0, totalAmount - advancePaid);
  return {
    roomSubtotal: booking.subtotal,
    extraChargesTotal,
    extraCharges: (booking.extraCharges || []).map((c) => ({
      description: c.description,
      amount: c.amount,
      category: c.category,
    })),
    subtotal,
    cgstPercentage: cgstPct,
    sgstPercentage: sgstPct,
    cgst,
    sgst,
    tax,
    totalAmount,
    advancePaid,
    balanceDue,
  };
};

// ── POST /api/reception/book ──────────────────────────────────────────────────
const createOfflineBooking = async (req, res, next) => {
  try {
    const {
      roomId, checkInDate, checkOutDate, guests,
      guestDetails, specialRequests, source,
    } = req.body;

    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);

    const room = await Room.findById(roomId);
    if (!room || !room.isActive) return sendError(res, 404, 'Room not found');
    if (room.status === ROOM_STATUS.MAINTENANCE) {
      return sendError(res, 409, 'Room is under maintenance');
    }

    const conflict = await Booking.findOne({
      room: roomId,
      status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CHECKED_IN, BOOKING_STATUS.PENDING] },
      $or: [{ checkInDate: { $lt: checkOut }, checkOutDate: { $gt: checkIn } }],
    });
    if (conflict) return sendError(res, 409, 'Room is not available for the selected dates');

    let guestUser = null;
    if (guestDetails?.email) {
      guestUser = await User.findOne({ email: guestDetails.email });
      if (!guestUser) {
        guestUser = await User.create({
          name: guestDetails.name,
          email: guestDetails.email,
          phone: guestDetails.phone,
          password: `Guest@${Date.now()}`,
          role: 'user',
        });
      }
    }

    const nights = calculateNights(checkIn, checkOut);
    const subtotal = room.price * nights;

    const booking = await Booking.create({
      bookingId: generateBookingId(),
      user: guestUser?._id || req.user._id,
      room: roomId,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      guests,
      nights,
      subtotal,
      tax: 0,
      totalAmount: subtotal,
      status: BOOKING_STATUS.CONFIRMED,
      source: source || BOOKING_SOURCE.OFFLINE,
      createdBy: req.user._id,
      guestDetails,
      specialRequests,
    });

    logger.info(`Offline booking created: ${booking.bookingId} by ${req.user._id}`);
    const populated = await populateBooking(Booking.findById(booking._id));
    return sendSuccess(res, 201, 'Offline booking created successfully', populated);
  } catch (error) {
    next(error);
  }
};

// ── GET /api/reception/bookings/:bookingId ────────────────────────────────────
const getBookingDetail = async (req, res, next) => {
  try {
    const booking = await populateBooking(Booking.findOne({ bookingId: req.params.bookingId }));
    if (!booking) return sendError(res, 404, 'Booking not found');
    const settings = await HotelSettings.getSettings();
    const invoicePreview = buildInvoiceData(booking, settings);
    return sendSuccess(res, 200, 'Booking fetched', { ...booking.toObject(), invoicePreview });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/reception/checkin ───────────────────────────────────────────────
const checkIn = async (req, res, next) => {
  try {
    const { bookingId, advancePaymentMethod = 'cash' } = req.body;

    const booking = await Booking.findOne({ bookingId }).populate('room');
    if (!booking) return sendError(res, 404, 'Booking not found');

    if (booking.status !== BOOKING_STATUS.CONFIRMED) {
      return sendError(res, 409, `Cannot check in — booking status is: ${booking.status}`);
    }

    const settings = await HotelSettings.getSettings();
    const advancePct = settings.advancePaymentPercent;
    const advancePaid = Math.round((booking.subtotal * advancePct) / 100);

    booking.status = BOOKING_STATUS.CHECKED_IN;
    booking.actualCheckIn = new Date();
    booking.advancePaid = advancePaid;
    booking.advancePaidAt = new Date();
    booking.advancePaymentMethod = advancePaymentMethod;
    await booking.save();

    await Room.findByIdAndUpdate(booking.room._id, { status: ROOM_STATUS.OCCUPIED });

    logger.info(`Check-in: ${bookingId} | Advance: ₹${advancePaid}`);
    return sendSuccess(res, 200, 'Guest checked in successfully', {
      bookingId: booking.bookingId,
      room: `Room ${booking.room.roomNumber}`,
      checkInTime: booking.actualCheckIn,
      advancePaid,
      advancePct,
      advancePaymentMethod,
    });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/reception/bookings/:bookingId/charges ───────────────────────────
const addExtraCharge = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const { description, amount, category = 'other' } = req.body;

    if (!description || amount === undefined) return sendError(res, 400, 'description and amount are required');
    if (Number(amount) <= 0) return sendError(res, 400, 'Amount must be positive');

    const booking = await Booking.findOne({ bookingId });
    if (!booking) return sendError(res, 404, 'Booking not found');
    if (booking.status !== BOOKING_STATUS.CHECKED_IN) {
      return sendError(res, 409, 'Extra charges can only be added to checked-in bookings');
    }

    booking.extraCharges.push({
      description,
      amount: Number(amount),
      category,
      addedBy: req.user._id,
      addedAt: new Date(),
    });
    await booking.save();

    const settings = await HotelSettings.getSettings();
    const invoicePreview = buildInvoiceData(booking, settings);

    logger.info(`Extra charge added to ${bookingId}: ${description} ₹${amount}`);
    return sendSuccess(res, 200, 'Charge added', { extraCharges: booking.extraCharges, invoicePreview });
  } catch (error) {
    next(error);
  }
};

// ── DELETE /api/reception/bookings/:bookingId/charges/:chargeId ───────────────
const removeExtraCharge = async (req, res, next) => {
  try {
    const { bookingId, chargeId } = req.params;

    const booking = await Booking.findOne({ bookingId });
    if (!booking) return sendError(res, 404, 'Booking not found');
    if (booking.status !== BOOKING_STATUS.CHECKED_IN) {
      return sendError(res, 409, 'Cannot modify charges on a non-checked-in booking');
    }

    booking.extraCharges = booking.extraCharges.filter(
      (c) => c._id.toString() !== chargeId
    );
    await booking.save();

    const settings = await HotelSettings.getSettings();
    const invoicePreview = buildInvoiceData(booking, settings);

    return sendSuccess(res, 200, 'Charge removed', { extraCharges: booking.extraCharges, invoicePreview });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/reception/checkout ──────────────────────────────────────────────
const checkOut = async (req, res, next) => {
  try {
    const { bookingId } = req.body;

    const booking = await populateBooking(Booking.findOne({ bookingId }));
    if (!booking) return sendError(res, 404, 'Booking not found');

    if (booking.status !== BOOKING_STATUS.CHECKED_IN) {
      return sendError(res, 409, `Cannot check out — booking status is: ${booking.status}`);
    }

    const settings = await HotelSettings.getSettings();
    const inv = buildInvoiceData(booking, settings);

    booking.tax = inv.tax;
    booking.totalAmount = inv.totalAmount;
    booking.status = BOOKING_STATUS.CHECKED_OUT;
    booking.actualCheckOut = new Date();
    await booking.save();

    await Room.findByIdAndUpdate(booking.room._id, { status: ROOM_STATUS.AVAILABLE });
    if (booking.user?._id) {
      await User.findByIdAndUpdate(booking.user._id, { $inc: { totalStays: 1 } });
    }

    // Upsert invoice
    let existingInvoiceNumber = (await Invoice.findOne({ booking: booking._id }))?.invoiceNumber;
    const invoiceDoc = await Invoice.findOneAndUpdate(
      { booking: booking._id },
      {
        invoiceNumber: existingInvoiceNumber || generateInvoiceNumber(),
        booking: booking._id,
        user: booking.user?._id || booking.createdBy,
        room: booking.room._id,
        ...inv,
        generatedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    logger.info(`Check-out: ${bookingId} | Invoice: ${invoiceDoc.invoiceNumber} | Total: ₹${inv.totalAmount}`);

    return sendSuccess(res, 200, 'Guest checked out successfully', {
      bookingId: booking.bookingId,
      room: `Room ${booking.room.roomNumber}`,
      guestName: booking.user?.name ?? booking.guestDetails?.name,
      checkOutTime: booking.actualCheckOut,
      invoice: invoiceDoc,
    });
  } catch (error) {
    next(error);
  }
};

// ── GET /api/reception/today ──────────────────────────────────────────────────
const getTodayActivity = async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [checkIns, checkOuts, currentGuests] = await Promise.all([
      populateBooking(Booking.find({
        checkInDate: { $gte: today, $lt: tomorrow },
        status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CHECKED_IN] },
      })),
      populateBooking(Booking.find({
        checkOutDate: { $gte: today, $lt: tomorrow },
        status: BOOKING_STATUS.CHECKED_IN,
      })),
      populateBooking(Booking.find({ status: BOOKING_STATUS.CHECKED_IN })),
    ]);

    return sendSuccess(res, 200, "Today's activity fetched", {
      todayCheckIns: checkIns,
      todayCheckOuts: checkOuts,
      currentlyOccupied: currentGuests,
      summary: {
        totalCheckIns: checkIns.length,
        totalCheckOuts: checkOuts.length,
        currentGuests: currentGuests.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOfflineBooking,
  getBookingDetail,
  checkIn,
  checkOut,
  addExtraCharge,
  removeExtraCharge,
  getTodayActivity,
};
const { sendSuccess, sendError } = require('../utils/response');
const {
  generateBookingId, generateInvoiceNumber, calculateNights, addGST,
} = require('../utils/helpers');
const logger = require('../utils/logger');

// POST /api/reception/book — offline / walk-in booking
const createOfflineBooking = async (req, res, next) => {
  try {
    const {
      roomId, checkInDate, checkOutDate, guests,
      guestDetails, specialRequests, source,
    } = req.body;

    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);

    const room = await Room.findById(roomId);
    if (!room || !room.isActive) return sendError(res, 404, 'Room not found');
    if (room.status === ROOM_STATUS.MAINTENANCE) {
      return sendError(res, 409, 'Room is under maintenance');
    }

    // Check availability
    const conflict = await Booking.findOne({
      room: roomId,
      status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CHECKED_IN, BOOKING_STATUS.PENDING] },
      $or: [{ checkInDate: { $lt: checkOut }, checkOutDate: { $gt: checkIn } }],
    });
    if (conflict) return sendError(res, 409, 'Room is not available for the selected dates');

    // Find or create guest user
    let guestUser = await User.findOne({ email: guestDetails.email });
    if (!guestUser && guestDetails.email) {
      guestUser = await User.create({
        name: guestDetails.name,
        email: guestDetails.email,
        phone: guestDetails.phone,
        password: `Guest@${Date.now()}`, // Temp password — user should reset
        role: 'user',
      });
    }

    const nights = calculateNights(checkIn, checkOut);
    const baseAmount = room.price * nights;
    const { subtotal, tax, totalAmount } = addGST(baseAmount);

    const booking = await Booking.create({
      bookingId: generateBookingId(),
      user: guestUser?._id || req.user._id,
      room: roomId,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      guests,
      nights,
      subtotal,
      tax,
      totalAmount,
      status: BOOKING_STATUS.CONFIRMED,
      source: source || BOOKING_SOURCE.OFFLINE,
      createdBy: req.user._id,
      guestDetails,
      specialRequests,
    });

    logger.info(`Offline booking created: ${booking.bookingId} by receptionist ${req.user._id}`);

    const populated = await booking.populate([
      { path: 'room', select: 'roomNumber type price' },
      { path: 'user', select: 'name email phone' },
    ]);

    return sendSuccess(res, 201, 'Offline booking created successfully', populated);
  } catch (error) {
    next(error);
  }
};

// POST /api/reception/checkin
const checkIn = async (req, res, next) => {
  try {
    const { bookingId } = req.body;

    const booking = await Booking.findOne({ bookingId }).populate('room');
    if (!booking) return sendError(res, 404, 'Booking not found');

    if (booking.status !== BOOKING_STATUS.CONFIRMED) {
      return sendError(res, 409, `Cannot check in — booking status is: ${booking.status}`);
    }

    booking.status = BOOKING_STATUS.CHECKED_IN;
    booking.actualCheckIn = new Date();
    await booking.save();

    // Mark room as occupied
    await Room.findByIdAndUpdate(booking.room._id, { status: ROOM_STATUS.OCCUPIED });

    logger.info(`Check-in completed: ${bookingId}`);
    return sendSuccess(res, 200, 'Guest checked in successfully', {
      bookingId: booking.bookingId,
      room: `Room ${booking.room.roomNumber}`,
      checkInTime: booking.actualCheckIn,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/reception/checkout
const checkOut = async (req, res, next) => {
  try {
    const { bookingId } = req.body;

    const booking = await Booking.findOne({ bookingId }).populate('room').populate('user', 'name email');
    if (!booking) return sendError(res, 404, 'Booking not found');

    if (booking.status !== BOOKING_STATUS.CHECKED_IN) {
      return sendError(res, 409, `Cannot check out — booking status is: ${booking.status}`);
    }

    booking.status = BOOKING_STATUS.CHECKED_OUT;
    booking.actualCheckOut = new Date();
    await booking.save();

    // Mark room as available
    await Room.findByIdAndUpdate(booking.room._id, { status: ROOM_STATUS.AVAILABLE, lastCleaned: null });

    // Update user total stays
    await User.findByIdAndUpdate(booking.user._id, { $inc: { totalStays: 1 } });

    // Ensure invoice exists
    let invoice = await Invoice.findOne({ booking: booking._id });
    if (!invoice) {
      invoice = await Invoice.create({
        invoiceNumber: generateInvoiceNumber(),
        booking: booking._id,
        user: booking.user._id,
        room: booking.room._id,
        subtotal: booking.subtotal,
        tax: booking.tax,
        totalAmount: booking.totalAmount,
      });
    }

    logger.info(`Check-out completed: ${bookingId}`);
    return sendSuccess(res, 200, 'Guest checked out successfully', {
      bookingId: booking.bookingId,
      room: `Room ${booking.room.roomNumber}`,
      checkOutTime: booking.actualCheckOut,
      invoiceNumber: invoice.invoiceNumber,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/reception/today — today's check-ins and check-outs
const getTodayActivity = async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [checkIns, checkOuts, currentGuests] = await Promise.all([
      Booking.find({
        checkInDate: { $gte: today, $lt: tomorrow },
        status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CHECKED_IN] },
      })
        .populate('user', 'name email phone')
        .populate('room', 'roomNumber type floor'),
      Booking.find({
        checkOutDate: { $gte: today, $lt: tomorrow },
        status: BOOKING_STATUS.CHECKED_IN,
      })
        .populate('user', 'name email phone')
        .populate('room', 'roomNumber type floor'),
      Booking.find({ status: BOOKING_STATUS.CHECKED_IN })
        .populate('user', 'name email phone')
        .populate('room', 'roomNumber type floor'),
    ]);

    return sendSuccess(res, 200, "Today's activity fetched", {
      todayCheckIns: checkIns,
      todayCheckOuts: checkOuts,
      currentlyOccupied: currentGuests,
      summary: {
        totalCheckIns: checkIns.length,
        totalCheckOuts: checkOuts.length,
        currentGuests: currentGuests.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { createOfflineBooking, checkIn, checkOut, getTodayActivity };
