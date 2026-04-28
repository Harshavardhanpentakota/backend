'use strict';

const crypto = require('crypto');
const Razorpay = require('razorpay');
const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const Invoice = require('../models/Invoice');
const {
  PAYMENT_STATUS, PAYMENT_METHOD, BOOKING_STATUS,
} = require('../constants');
const { sendSuccess, sendError } = require('../utils/response');
const { generateInvoiceNumber } = require('../utils/helpers');
const logger = require('../utils/logger');

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

    if (booking.paymentStatus === PAYMENT_STATUS.PAID) {
      return sendError(res, 409, 'Booking is already paid');
    }

    const order = await getRazorpay().orders.create({
      amount: Math.round(booking.totalAmount * 100), // paise
      currency: 'INR',
      receipt: booking.bookingId,
      notes: {
        bookingId: booking._id.toString(),
        userId: req.user._id.toString(),
      },
    });

    // Create a pending payment record
    await Payment.findOneAndUpdate(
      { booking: booking._id },
      {
        booking: booking._id,
        user: req.user._id,
        amount: booking.totalAmount,
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

    // Update booking payment status
    await Booking.findByIdAndUpdate(bookingId, {
      paymentStatus: PAYMENT_STATUS.PAID,
      status: BOOKING_STATUS.CONFIRMED,
    });

    // Generate invoice
    const booking = await Booking.findById(bookingId);
    const invoice = await Invoice.create({
      invoiceNumber: generateInvoiceNumber(),
      booking: bookingId,
      payment: payment._id,
      user: req.user._id,
      room: booking.room,
      subtotal: booking.subtotal,
      tax: booking.tax,
      totalAmount: booking.totalAmount,
    });

    logger.info(`Payment verified for booking ${bookingId} — txn: ${razorpayPaymentId}`);
    return sendSuccess(res, 200, 'Payment verified successfully', {
      payment,
      invoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
    });
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
      room: booking.room,
      subtotal: booking.subtotal,
      tax: booking.tax,
      totalAmount: booking.totalAmount,
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

module.exports = { createRazorpayOrder, verifyRazorpayPayment, recordOfflinePayment, getPaymentByBooking };
