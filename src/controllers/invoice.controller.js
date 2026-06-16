'use strict';

const { PassThrough } = require('stream');
const Invoice = require('../models/Invoice');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Room = require('../models/Room');
const User = require('../models/User');
const { sendSuccess, sendError } = require('../utils/response');
const { generateInvoicePDF } = require('../utils/pdf');
const { sendEmail } = require('../utils/email');
const { HOTEL } = require('../constants');
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

// GET /api/invoices  — list all invoices (admin / receptionist)
const listInvoices = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search = '', startDate, endDate } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const limitNum = Math.min(Number(limit), 100);

    const filter = {};
    if (startDate || endDate) {
      filter.generatedAt = {};
      if (startDate) filter.generatedAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.generatedAt.$lte = end;
      }
    }

    if (search) {
      const [bookingMatches, userMatches] = await Promise.all([
        Booking.find({ bookingId: { $regex: search, $options: 'i' } }).select('_id'),
        User.find({ name: { $regex: search, $options: 'i' } }).select('_id'),
      ]);
      filter.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } },
        ...(bookingMatches.length > 0 ? [{ booking: { $in: bookingMatches.map((b) => b._id) } }] : []),
        ...(userMatches.length > 0 ? [{ user: { $in: userMatches.map((u) => u._id) } }] : []),
      ];
    }

    const [invoices, total] = await Promise.all([
      Invoice.find(filter)
        .populate('booking', 'bookingId checkInDate checkOutDate actualCheckOut nights status')
        .populate('user', 'name email phone')
        .populate('room', 'roomNumber type')
        .sort({ generatedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Invoice.countDocuments(filter),
    ]);

    return sendSuccess(res, 200, 'Invoices fetched', invoices, {
      total,
      page: Number(page),
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/invoices/:bookingId/email  — email invoice PDF to guest
const sendInvoiceEmail = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.bookingId);
    if (!booking) return sendError(res, 404, 'Booking not found');

    const invoice = await Invoice.findOne({ booking: req.params.bookingId });
    if (!invoice) return sendError(res, 404, 'Invoice not found');

    const [user, room, payment] = await Promise.all([
      User.findById(booking.user),
      Room.findById(booking.room),
      Payment.findOne({ booking: booking._id }),
    ]);

    const guestEmail = user?.email ?? booking.guestDetails?.email;
    if (!guestEmail) return sendError(res, 400, 'No email address found for this guest');

    const guestData = user ?? {
      name: booking.guestDetails?.name ?? 'Guest',
      email: guestEmail,
      phone: booking.guestDetails?.phone ?? '',
    };
    const roomData = room ?? {
      roomNumber: 'N/A',
      type: booking.roomType ?? 'Room',
      price: booking.pricePerNight ?? 0,
    };

    // Generate PDF into an in-memory buffer
    const chunks = [];
    const stream = new PassThrough();
    stream.on('data', (c) => chunks.push(c));

    await new Promise((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
      generateInvoicePDF({ invoice, booking, user: guestData, room: roomData, payment }, stream);
    });

    const pdfBuffer = Buffer.concat(chunks);
    const fmt = (n) => '₹' + Number(n).toLocaleString('en-IN');

    await sendEmail({
      to: guestEmail,
      subject: `Invoice #${invoice.invoiceNumber} — ${HOTEL.NAME}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #e5e7eb;border-radius:8px;">
          <h2 style="color:#1e3a5f;">${HOTEL.NAME}</h2>
          <p>Dear ${guestData.name},</p>
          <p>Thank you for your stay! Please find your invoice attached as a PDF.</p>
          <table style="width:100%;border-collapse:collapse;margin-top:16px;">
            <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Invoice #</td><td style="padding:8px;border:1px solid #e5e7eb;">${invoice.invoiceNumber}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Booking ID</td><td style="padding:8px;border:1px solid #e5e7eb;">${booking.bookingId}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Total Amount</td><td style="padding:8px;border:1px solid #e5e7eb;">${fmt(invoice.totalAmount)}</td></tr>
          </table>
          <p style="margin-top:20px;color:#6b7280;font-size:12px;">${HOTEL.ADDRESS} | ${HOTEL.PHONE}</p>
        </div>`,
      attachments: [{
        filename: `invoice-${invoice.invoiceNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    });

    logger.info(`Invoice email sent: ${invoice.invoiceNumber} → ${guestEmail}`);
    return sendSuccess(res, 200, `Invoice emailed to ${guestEmail}`);
  } catch (error) {
    next(error);
  }
};

module.exports = { getInvoiceByBooking, downloadInvoicePDF, listInvoices, sendInvoiceEmail };
