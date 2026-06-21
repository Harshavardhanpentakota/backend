'use strict';

const crypto = require('crypto');
const Razorpay = require('razorpay');
const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const Invoice = require('../models/Invoice');
const HotelSettings = require('../models/HotelSettings');
const {
  PAYMENT_STATUS, PAYMENT_METHOD, BOOKING_STATUS,
} = require('../constants');
const { sendSuccess, sendError } = require('../utils/response');
const { generateInvoiceNumber } = require('../utils/helpers');
const logger = require('../utils/logger');
const { createNotification } = require('../utils/notification');
const { logActivity } = require('../utils/activity');
const { getRoomTypeAvailability, acquireLock } = require('../utils/availability');

let razorpayInstance;
const getRazorpay = () => {
  if (!razorpayInstance) {
    razorpayInstance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpayInstance;
};

// POST /api/payments/razorpay/order
const createRazorpayOrder = async (req, res, next) => {
  try {
    const { bookingId } = req.body;

    const booking = await Booking.findById(bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found');

    if (String(booking.user) !== String(req.user._id)) {
      return sendError(res, 403, 'Access denied');
    }

    if (booking.advancePaid > 0) {
      return sendError(res, 409, 'Advance has already been paid for this booking');
    }

    // Availability Engine check before creating Razorpay order
    const availability = await getRoomTypeAvailability(booking.roomType, booking.checkInDate, booking.checkOutDate);
    if (availability.available < 1) {
      booking.status = BOOKING_STATUS.CANCELLED;
      booking.cancellationReason = 'No rooms available of this type for the selected dates';
      booking.cancellationDate = new Date();
      await booking.save();
      return sendError(res, 400, 'Rooms of this type are no longer available for your selected dates. Booking has been cancelled.');
    }

    // Calculate advance amount from hotel settings
    const settings = await HotelSettings.getSettings();
    const advancePercent = settings.advancePaymentPercent || 10;
    const advanceAmount = Math.max(1, Math.round(booking.totalAmount * advancePercent / 100));

    const order = await getRazorpay().orders.create({
      amount: Math.round(advanceAmount * 100), // paise
      currency: 'INR',
      receipt: booking.bookingId,
      notes: {
        bookingId: booking._id.toString(),
        userId: req.user._id.toString(),
        advancePercent: String(advancePercent),
      },
    });

    // Create a pending payment record
    await Payment.findOneAndUpdate(
      { booking: booking._id },
      {
        booking: booking._id,
        user: req.user._id,
        amount: advanceAmount,
        method: PAYMENT_METHOD.RAZORPAY,
        status: PAYMENT_STATUS.PENDING,
        razorpayOrderId: order.id,
      },
      { upsert: true, new: true }
    );

    return sendSuccess(res, 200, 'Razorpay order created', {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      bookingId: booking._id,
      advanceAmount,
      advancePercent,
      totalAmount: booking.totalAmount,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/payments/razorpay/verify
const verifyRazorpayPayment = async (req, res, next) => {
  try {
    const { bookingId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    // Verify signature
    const body = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      logger.warn(`Razorpay signature mismatch for booking ${bookingId}`);
      return sendError(res, 400, 'Payment verification failed: invalid signature');
    }

    const payment = await Payment.findOneAndUpdate(
      { razorpayOrderId },
      {
        status: PAYMENT_STATUS.PAID,
        razorpayPaymentId,
        razorpaySignature,
        paidAt: new Date(),
        transactionId: razorpayPaymentId,
      },
      { new: true }
    );

    if (!payment) return sendError(res, 404, 'Payment record not found');

    // Update booking: mark advance as paid, confirm the booking
    const advancePaid = payment.amount;
    const booking = await Booking.findById(bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found');

    const release = acquireLock(booking.roomType);
    try {
      const availability = await getRoomTypeAvailability(booking.roomType, booking.checkInDate, booking.checkOutDate);
      if (availability.available < 1) {
        logger.warn(`Overbooking detected for booking ${bookingId} on payment verification. Refunding.`);

        let refundId = null;
        const refundAmount = payment.amount;
        try {
          const razorpay = getRazorpay();
          const rzRefund = await razorpay.payments.refund(razorpayPaymentId, {
            amount: Math.round(refundAmount * 100), // paise
            notes: { reason: 'Room type no longer available (automatically refunded)' },
          });
          refundId = rzRefund.id;
        } catch (rzErr) {
          logger.error(`Automated refund failed for booking ${bookingId}:`, rzErr.message);
        }

        // Cancel the booking and mark paymentStatus as REFUNDED
        booking.status = BOOKING_STATUS.CANCELLED;
        booking.paymentStatus = PAYMENT_STATUS.REFUNDED;
        booking.cancellationDate = new Date();
        booking.cancellationReason = 'No rooms available (automatically refunded)';
        booking.refundAmount = refundAmount;
        await booking.save();

        // Update payment status
        payment.status = PAYMENT_STATUS.REFUNDED;
        payment.refundId = refundId;
        payment.refundAmount = refundAmount;
        payment.refundDate = new Date();
        await payment.save();

        // Notify User
        await createNotification({
          recipientId: booking.user,
          title: 'Booking Overbooked & Refunded',
          message: `Your booking #${booking.bookingId} could not be confirmed as no rooms of this type were left. A full refund of ₹${refundAmount} has been issued.`,
          type: 'booking_cancelled',
          metadata: { bookingId: booking._id, refundAmount }
        });

        // Notify staff
        await createNotification({
          recipientRole: 'receptionist',
          title: 'Overbooked Booking Refunded',
          message: `Booking #${booking.bookingId} was cancelled and refunded automatically due to no room availability.`,
          type: 'booking_cancelled',
          metadata: { bookingId: booking._id }
        });

        return sendError(res, 409, 'Payment succeeded, but rooms are no longer available. A refund has been automatically initiated.');
      }

      booking.status = BOOKING_STATUS.CONFIRMED;
      booking.advancePaid = advancePaid;
      booking.advancePaidAt = new Date();
      booking.advancePaymentMethod = PAYMENT_METHOD.RAZORPAY;
      await booking.save();

      // Generate invoice (room may be null for type-based bookings)
      const invoice = await Invoice.create({
        invoiceNumber: generateInvoiceNumber(),
        booking: bookingId,
        payment: payment._id,
        user: req.user._id,
        room: booking.room || undefined,
        roomType: booking.roomType,
        roomSubtotal: booking.subtotal,
        subtotal: booking.subtotal,
        tax: booking.tax,
        totalAmount: booking.totalAmount,
        advancePaid,
        advancePaymentMethod: PAYMENT_METHOD.RAZORPAY,
        balanceDue: booking.totalAmount - advancePaid,
      });

      // Notify User
      await createNotification({
        recipientId: booking.user,
        title: 'Booking Confirmed',
        message: `Your booking #${booking.bookingId} has been confirmed.`,
        type: 'booking_confirmed',
        metadata: { booking }
      });

      await createNotification({
        recipientId: booking.user,
        title: 'Payment Successful',
        message: `Payment of ₹${payment.amount} received successfully for Booking #${booking.bookingId}.`,
        type: 'payment_successful',
        metadata: { payment, booking }
      });

      // Notify Reception & Admin
      await createNotification({
        recipientRole: 'receptionist',
        title: 'Payment Completed',
        message: `Payment of ₹${payment.amount} received for Booking #${booking.bookingId}.`,
        type: 'payment_completed',
        metadata: { payment, booking }
      });

      await createNotification({
        recipientRole: 'admin',
        title: 'Payment Completed',
        message: `Payment of ₹${payment.amount} received for Booking #${booking.bookingId}.`,
        type: 'payment_completed',
        metadata: { payment, booking }
      });

      // Log Activities
      await logActivity({
        req,
        action: 'Payment Verified',
        module: 'Payments',
        entityId: payment._id.toString(),
        entityType: 'Payment',
        description: `Razorpay payment of ₹${payment.amount} verified for Booking #${booking.bookingId}`,
        newData: payment.toObject()
      });

      await logActivity({
        req,
        action: 'Booking Confirmed',
        module: 'Bookings',
        entityId: booking._id.toString(),
        entityType: 'Booking',
        description: `Booking #${booking.bookingId} confirmed automatically on payment verification`,
        newData: { status: BOOKING_STATUS.CONFIRMED }
      });

      logger.info(`Payment verified for booking ${bookingId} — txn: ${razorpayPaymentId}`);
      return sendSuccess(res, 200, 'Payment verified successfully', {
        payment,
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
      });
    } finally {
      release();
    }
  } catch (error) {
    next(error);
  }
};

// POST /api/payments/offline  (receptionist / admin)
const recordOfflinePayment = async (req, res, next) => {
  try {
    const { bookingId, method, transactionId, notes } = req.body;

    const booking = await Booking.findById(bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found');

    if (booking.paymentStatus === PAYMENT_STATUS.PAID) {
      return sendError(res, 409, 'Booking is already paid');
    }

    const payment = await Payment.create({
      booking: bookingId,
      user: booking.user,
      amount: booking.totalAmount,
      method,
      status: PAYMENT_STATUS.PAID,
      transactionId: transactionId || `CASH-${Date.now()}`,
      paidAt: new Date(),
      notes,
    });

    await Booking.findByIdAndUpdate(bookingId, {
      paymentStatus: PAYMENT_STATUS.PAID,
      status: BOOKING_STATUS.CONFIRMED,
    });

    // Generate invoice
    const invoice = await Invoice.create({
      invoiceNumber: generateInvoiceNumber(),
      booking: bookingId,
      payment: payment._id,
      user: booking.user,
      room: booking.room || undefined,
      roomType: booking.roomType,
      roomSubtotal: booking.subtotal,
      subtotal: booking.subtotal,
      tax: booking.tax,
      totalAmount: booking.totalAmount,
    });

    // Notify User
    await createNotification({
      recipientId: booking.user,
      title: 'Booking Confirmed',
      message: `Your booking #${booking.bookingId} has been confirmed.`,
      type: 'booking_confirmed',
      metadata: { booking }
    });

    await createNotification({
      recipientId: booking.user,
      title: 'Payment Successful',
      message: `Payment of ₹${payment.amount} received successfully for Booking #${booking.bookingId}.`,
      type: 'payment_successful',
      metadata: { payment, booking }
    });

    // Notify Reception & Admin
    await createNotification({
      recipientRole: 'receptionist',
      title: 'Payment Completed',
      message: `Payment of ₹${payment.amount} received for Booking #${booking.bookingId}.`,
      type: 'payment_completed',
      metadata: { payment, booking }
    });

    await createNotification({
      recipientRole: 'admin',
      title: 'Payment Completed',
      message: `Payment of ₹${payment.amount} received for Booking #${booking.bookingId}.`,
      type: 'payment_completed',
      metadata: { payment, booking }
    });

    // Log Activities
    await logActivity({
      req,
      action: 'Offline Payment Recorded',
      module: 'Payments',
      entityId: payment._id.toString(),
      entityType: 'Payment',
      description: `Offline payment of ₹${payment.amount} recorded for Booking #${booking.bookingId}`,
      newData: payment.toObject()
    });

    await logActivity({
      req,
      action: 'Booking Confirmed',
      module: 'Bookings',
      entityId: booking._id.toString(),
      entityType: 'Booking',
      description: `Booking #${booking.bookingId} confirmed manually on offline payment recorded`,
      newData: { status: BOOKING_STATUS.CONFIRMED }
    });

    logger.info(`Offline payment recorded for booking ${bookingId}`);
    return sendSuccess(res, 201, 'Payment recorded successfully', {
      payment,
      invoiceNumber: invoice.invoiceNumber,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/payments  (admin / receptionist — list all with filters)
const getAllPayments = async (req, res, next) => {
  try {
    const {
      page = 1, limit = 20, status, method, startDate, endDate, search,
    } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (method) filter.method = method;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = Payment.find(filter)
      .populate('booking', 'bookingId roomType checkInDate checkOutDate totalAmount status guestDetails')
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const [payments, total, aggregateResult] = await Promise.all([
      query,
      Payment.countDocuments(filter),
      // Aggregate totals across ALL filtered payments (not just this page)
      Payment.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalPaidAmount: {
              $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] }
            },
            totalRefundedAmount: {
              $sum: { $cond: [{ $in: ['$status', ['refunded', 'partially_refunded']] }, { $ifNull: ['$refundAmount', '$amount'] }, 0] }
            },
            totalPendingCount: {
              $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
            },
          }
        }
      ]),
    ]);

    // Client-side search on populated fields (booking ID / guest name)
    let results = payments;
    if (search) {
      const q = search.toLowerCase();
      results = payments.filter((p) => {
        const bookingId = (p.booking?.bookingId ?? '').toLowerCase();
        const guestName = (p.booking?.guestDetails?.name ?? p.user?.name ?? '').toLowerCase();
        const guestPhone = (p.booking?.guestDetails?.phone ?? p.user?.phone ?? '').toLowerCase();
        const txn = (p.transactionId ?? '').toLowerCase();
        return bookingId.includes(q) || guestName.includes(q) || guestPhone.includes(q) || txn.includes(q);
      });
    }

    const agg = aggregateResult[0] || { totalPaidAmount: 0, totalRefundedAmount: 0, totalPendingCount: 0 };

    return sendSuccess(res, 200, 'Payments fetched', results, {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
      totalPaidAmount: agg.totalPaidAmount,
      totalRefundedAmount: agg.totalRefundedAmount,
      totalPendingCount: agg.totalPendingCount,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/payments/:id/refund  (admin / receptionist)
const refundPayment = async (req, res, next) => {
  try {
    const payment = await Payment.findById(req.params.id).populate('booking');
    if (!payment) return sendError(res, 404, 'Payment not found');

    if (payment.status !== PAYMENT_STATUS.PAID) {
      return sendError(res, 400, `Cannot refund a payment with status "${payment.status}"`);
    }

    const { reason = 'Refund initiated by staff', refundAmount, password } = req.body;

    if (!password) {
      return sendError(res, 400, 'Password is required to confirm refund');
    }

    const User = require('../models/User');
    const staffUser = await User.findById(req.user._id).select('+password');
    if (!staffUser) {
      return sendError(res, 404, 'Staff account not found');
    }

    const isMatch = await staffUser.comparePassword(password);
    if (!isMatch) {
      return sendError(res, 401, 'Invalid password. Refund unauthorized.');
    }

    const amount = refundAmount ? Math.min(Number(refundAmount), payment.amount) : payment.amount;

    let refundId = null;

    // Online payment — trigger Razorpay refund
    if (payment.method === PAYMENT_METHOD.RAZORPAY && payment.razorpayPaymentId) {
      try {
        const rzRefund = await getRazorpay().payments.refund(payment.razorpayPaymentId, {
          amount: Math.round(amount * 100), // paise
          notes: { reason },
        });
        refundId = rzRefund.id;
      } catch (rzErr) {
        logger.error('Razorpay refund error:', rzErr.message);
        return sendError(res, 502, `Razorpay refund failed: ${rzErr.error?.description ?? rzErr.message}`);
      }
    }

    const isPartial = amount < payment.amount;
    const newStatus = isPartial ? PAYMENT_STATUS.PARTIALLY_REFUNDED : PAYMENT_STATUS.REFUNDED;

    await Payment.findByIdAndUpdate(req.params.id, {
      status: newStatus,
      refundId,
      refundAmount: amount,
      refundDate: new Date(),
      notes: reason,
    });

    // Update booking payment status
    await Booking.findByIdAndUpdate(payment.booking._id ?? payment.booking, {
      paymentStatus: newStatus,
    });

    logger.info(`Refund of ₹${amount} processed for payment ${req.params.id} by ${req.user._id}`);
    
    // Notify User
    await createNotification({
      recipientId: payment.user,
      title: 'Refund Processed',
      message: `A refund of ₹${amount} has been processed for Booking #${payment.booking.bookingId || payment.booking}.`,
      type: 'refund_processed',
      metadata: { payment, refundAmount: amount }
    });

    // Notify Reception
    await createNotification({
      recipientRole: 'receptionist',
      title: 'Refund Processed',
      message: `Refund of ₹${amount} processed for Booking #${payment.booking.bookingId || payment.booking}.`,
      type: 'refund_processed',
      metadata: { payment, refundAmount: amount }
    });

    // Log Activity
    await logActivity({
      req,
      action: 'Refund Processed',
      module: 'Payments',
      entityId: payment._id.toString(),
      entityType: 'Payment',
      description: `Refund of ₹${amount} processed for Booking #${payment.booking.bookingId || payment.booking}`,
      newData: { refundAmount: amount }
    });

    return sendSuccess(res, 200, 'Refund processed successfully', {
      refundId,
      refundAmount: amount,
      status: newStatus,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/payments/:bookingId
const getPaymentByBooking = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found');

    if (req.user.role === 'user' && String(booking.user) !== String(req.user._id)) {
      return sendError(res, 403, 'Access denied');
    }

    const payment = await Payment.findOne({ booking: req.params.bookingId });
    if (!payment) return sendError(res, 404, 'Payment not found');

    return sendSuccess(res, 200, 'Payment fetched', payment);
  } catch (error) {
    next(error);
  }
};

// GET /api/payments/export  (admin / receptionist — export as CSV)
const exportPayments = async (req, res, next) => {
  try {
    const { status, method, startDate, endDate, search } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (method) filter.method = method;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const payments = await Payment.find(filter)
      .populate('booking', 'bookingId roomType checkInDate checkOutDate totalAmount status guestDetails')
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 })
      .limit(10000);

    // Apply search filter
    let results = payments;
    if (search) {
      const q = search.toLowerCase();
      results = payments.filter((p) => {
        const bookingId = (p.booking?.bookingId ?? '').toLowerCase();
        const guestName = (p.booking?.guestDetails?.name ?? p.user?.name ?? '').toLowerCase();
        const guestPhone = (p.booking?.guestDetails?.phone ?? p.user?.phone ?? '').toLowerCase();
        const txn = (p.transactionId ?? '').toLowerCase();
        return bookingId.includes(q) || guestName.includes(q) || guestPhone.includes(q) || txn.includes(q);
      });
    }

    // Build CSV
    const escapeCSV = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const headers = ['Date', 'Booking ID', 'Guest Name', 'Guest Phone', 'Method', 'Amount (₹)', 'Status', 'Transaction ID', 'Refund Amount (₹)', 'Notes'];
    const rows = results.map((p) => [
      p.paidAt ? new Date(p.paidAt).toISOString() : new Date(p.createdAt).toISOString(),
      p.booking?.bookingId ?? '',
      p.booking?.guestDetails?.name ?? p.user?.name ?? 'Guest',
      p.booking?.guestDetails?.phone ?? p.user?.phone ?? p.user?.email ?? '',
      p.method,
      p.amount,
      p.status,
      p.razorpayPaymentId ?? p.transactionId ?? '',
      p.refundAmount ?? '',
      p.notes ?? '',
    ].map(escapeCSV).join(','));

    const csvContent = [headers.map(escapeCSV).join(','), ...rows].join('\n');
    const filename = `payments_export_${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send('\uFEFF' + csvContent); // BOM for Excel compatibility
  } catch (error) {
    next(error);
  }
};

module.exports = { createRazorpayOrder, verifyRazorpayPayment, recordOfflinePayment, getPaymentByBooking, getAllPayments, refundPayment, exportPayments };
