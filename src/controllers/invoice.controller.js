'use strict';

const Invoice = require('../models/Invoice');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Room = require('../models/Room');
const User = require('../models/User');
const { sendSuccess, sendError } = require('../utils/response');
const { generateInvoicePDF } = require('../utils/pdf');
const logger = require('../utils/logger');

// GET /api/invoices/:bookingId
const getInvoiceByBooking = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found');

    if (req.user.role === 'user' && String(booking.user) !== String(req.user._id)) {
      return sendError(res, 403, 'Access denied');
    }

    const invoice = await Invoice.findOne({ booking: req.params.bookingId })
      .populate('booking')
      .populate('user', 'name email phone')
      .populate('room', 'roomNumber type price')
      .populate('payment');

    if (!invoice) return sendError(res, 404, 'Invoice not found');

    return sendSuccess(res, 200, 'Invoice fetched', invoice);
  } catch (error) {
    next(error);
  }
};

// GET /api/invoices/:bookingId/pdf  — stream PDF to client
const downloadInvoicePDF = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found');

    if (req.user.role === 'user' && String(booking.user) !== String(req.user._id)) {
      return sendError(res, 403, 'Access denied');
    }

    const invoice = await Invoice.findOne({ booking: req.params.bookingId });
    const user = await User.findById(booking.user);
    const room = await Room.findById(booking.room);
    const payment = await Payment.findOne({ booking: booking._id });

    if (!invoice) return sendError(res, 404, 'Invoice not found');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`
    );

    generateInvoicePDF({ invoice, booking, user, room, payment }, res);
    logger.info(`Invoice PDF downloaded: ${invoice.invoiceNumber}`);
  } catch (error) {
    next(error);
  }
};

module.exports = { getInvoiceByBooking, downloadInvoicePDF };
