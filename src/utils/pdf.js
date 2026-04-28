'use strict';

const PDFDocument = require('pdfkit');
const { HOTEL } = require('../constants');

/**
 * Generates an invoice PDF and pipes it to the given writable stream (or response).
 * @param {object} invoiceData
 * @param {import('stream').Writable} outputStream
 */
const generateInvoicePDF = (invoiceData, outputStream) => {
  const { invoice, booking, user, room, payment } = invoiceData;

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(outputStream);

  const primaryColor = '#1e3a5f';
  const accentColor = '#3b82f6';
  const lightGray = '#f3f4f6';
  const textGray = '#6b7280';

  // ── Header ──────────────────────────────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 90).fill(primaryColor);

  doc.fill('white').fontSize(22).font('Helvetica-Bold')
    .text(HOTEL.NAME, 50, 25);

  doc.fontSize(9).font('Helvetica')
    .text(HOTEL.ADDRESS, 50, 52, { width: 350 })
    .text(`Phone: ${HOTEL.PHONE}  |  Email: ${HOTEL.EMAIL}`, 50, 68);

  doc.fill(accentColor).fontSize(14).font('Helvetica-Bold')
    .text('INVOICE', doc.page.width - 150, 35);

  doc.fill(primaryColor).rect(0, 90, doc.page.width, 2).fill(accentColor);

  // ── Invoice Meta ─────────────────────────────────────────────────────────────
  doc.moveDown(2);
  const metaTop = 115;

  doc.fill(primaryColor).fontSize(10).font('Helvetica-Bold')
    .text('Invoice Details', 50, metaTop);

  doc.fill(textGray).font('Helvetica').fontSize(9)
    .text(`Invoice No: ${invoice.invoiceNumber}`, 50, metaTop + 18)
    .text(`Generated: ${new Date(invoice.generatedAt).toLocaleDateString('en-IN')}`, 50, metaTop + 32)
    .text(`Booking ID: ${booking.bookingId}`, 50, metaTop + 46);

  doc.fill(primaryColor).fontSize(10).font('Helvetica-Bold')
    .text('Guest Details', 300, metaTop);

  doc.fill(textGray).font('Helvetica').fontSize(9)
    .text(`Name: ${user.name}`, 300, metaTop + 18)
    .text(`Email: ${user.email}`, 300, metaTop + 32)
    .text(`Phone: ${user.phone || 'N/A'}`, 300, metaTop + 46);

  // ── Booking Details ───────────────────────────────────────────────────────────
  const tableTop = metaTop + 90;

  doc.rect(50, tableTop, doc.page.width - 100, 22).fill(primaryColor);
  doc.fill('white').fontSize(9).font('Helvetica-Bold')
    .text('Room', 60, tableTop + 7)
    .text('Type', 180, tableTop + 7)
    .text('Check-in', 280, tableTop + 7)
    .text('Check-out', 380, tableTop + 7)
    .text('Nights', 470, tableTop + 7);

  const nights = Math.max(
    1,
    Math.ceil(
      (new Date(booking.checkOutDate) - new Date(booking.checkInDate)) / (1000 * 60 * 60 * 24)
    )
  );

  doc.rect(50, tableTop + 22, doc.page.width - 100, 22).fill(lightGray);
  doc.fill(primaryColor).fontSize(9).font('Helvetica')
    .text(`Room ${room.roomNumber}`, 60, tableTop + 29)
    .text(room.type, 180, tableTop + 29)
    .text(new Date(booking.checkInDate).toLocaleDateString('en-IN'), 280, tableTop + 29)
    .text(new Date(booking.checkOutDate).toLocaleDateString('en-IN'), 380, tableTop + 29)
    .text(String(nights), 470, tableTop + 29);

  // ── Price Breakdown ────────────────────────────────────────────────────────────
  const priceTop = tableTop + 80;

  doc.fill(primaryColor).fontSize(10).font('Helvetica-Bold')
    .text('Price Breakdown', 50, priceTop);

  const lineY = (n) => priceTop + 18 + n * 20;
  const rightCol = doc.page.width - 100;

  const subtotal = invoice.subtotal || booking.totalAmount / 1.12;
  const tax = invoice.tax || booking.totalAmount - subtotal;
  const total = invoice.totalAmount || booking.totalAmount;

  const rows = [
    [`Room rate (₹${room.price}/night × ${nights} nights)`, `₹${subtotal.toFixed(2)}`],
    [`GST (${HOTEL.GST_PERCENTAGE || 12}%)`, `₹${tax.toFixed(2)}`],
  ];

  rows.forEach(([label, value], i) => {
    doc.fill(textGray).font('Helvetica').fontSize(9)
      .text(label, 60, lineY(i))
      .text(value, rightCol, lineY(i), { align: 'right', width: 40 });
  });

  doc.rect(50, lineY(rows.length) + 5, doc.page.width - 100, 1).fill(accentColor);

  doc.fill(primaryColor).font('Helvetica-Bold').fontSize(11)
    .text('Total Amount', 60, lineY(rows.length) + 12)
    .text(`₹${total.toFixed(2)}`, rightCol, lineY(rows.length) + 12, { align: 'right', width: 40 });

  // ── Payment Info ──────────────────────────────────────────────────────────────
  const payTop = lineY(rows.length) + 55;

  doc.fill(primaryColor).fontSize(10).font('Helvetica-Bold')
    .text('Payment Information', 50, payTop);

  doc.fill(textGray).font('Helvetica').fontSize(9)
    .text(`Method: ${(payment?.method || 'N/A').toUpperCase()}`, 60, payTop + 18)
    .text(`Status: ${(payment?.status || 'N/A').toUpperCase()}`, 60, payTop + 32)
    .text(`Transaction ID: ${payment?.transactionId || 'N/A'}`, 60, payTop + 46);

  // ── Footer ────────────────────────────────────────────────────────────────────
  doc.rect(0, doc.page.height - 50, doc.page.width, 50).fill(lightGray);
  doc.fill(textGray).fontSize(8).font('Helvetica')
    .text(
      `Thank you for choosing ${HOTEL.NAME}. Check-in: ${HOTEL.CHECKIN_TIME} | Check-out: ${HOTEL.CHECKOUT_TIME}`,
      50,
      doc.page.height - 35,
      { align: 'center', width: doc.page.width - 100 }
    );

  doc.end();
};

module.exports = { generateInvoicePDF };
