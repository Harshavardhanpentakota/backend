'use strict';

const nodemailer = require('nodemailer');
const logger = require('./logger');
const { HOTEL } = require('../constants');

let transporter;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
};

/**
 * Send a raw email.
 */
const sendEmail = async ({ to, subject, html, text, attachments = [] }) => {
  if (!to) {
    logger.warn(`Email not sent: recipient address is empty/missing (subject: "${subject}")`);
    return null;
  }
  try {
    const info = await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || `"${HOTEL.NAME}" <noreply@hotelabhitejinn.com>`,
      to,
      subject,
      html,
      text,
      attachments,
    });
    logger.info(`Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error(`Email send failed to ${to}: ${error.message}`);
    throw error;
  }
};

// ── Template helpers ──────────────────────────────────────────────────────────

const bookingConfirmationEmail = (booking, user, room) => ({
  to: user.email,
  subject: `Booking Confirmed — ${HOTEL.NAME} | #${booking.bookingId}`,
  html: `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #e5e7eb;border-radius:8px;">
      <h2 style="color:#1e3a5f;">${HOTEL.NAME}</h2>
      <p>Dear ${user.name},</p>
      <p>Your booking has been <strong>confirmed</strong>. Here are the details:</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Booking ID</td><td style="padding:8px;border:1px solid #e5e7eb;">${booking.bookingId}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Room</td><td style="padding:8px;border:1px solid #e5e7eb;">${room.roomNumber} — ${room.type}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Check-in</td><td style="padding:8px;border:1px solid #e5e7eb;">${new Date(booking.checkInDate).toDateString()} at ${HOTEL.CHECKIN_TIME}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Check-out</td><td style="padding:8px;border:1px solid #e5e7eb;">${new Date(booking.checkOutDate).toDateString()} at ${HOTEL.CHECKOUT_TIME}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Guests</td><td style="padding:8px;border:1px solid #e5e7eb;">${booking.guests}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Total Amount</td><td style="padding:8px;border:1px solid #e5e7eb;">₹${booking.totalAmount.toLocaleString('en-IN')}</td></tr>
      </table>
      <p style="margin-top:20px;">We look forward to hosting you at <strong>${HOTEL.NAME}</strong>.</p>
      <p style="color:#6b7280;font-size:12px;">Address: ${HOTEL.ADDRESS} | Phone: ${HOTEL.PHONE}</p>
    </div>
  `,
});

const cancellationEmail = (booking, user, refundAmount) => ({
  to: user.email,
  subject: `Booking Cancelled — ${HOTEL.NAME} | #${booking.bookingId}`,
  html: `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #e5e7eb;border-radius:8px;">
      <h2 style="color:#1e3a5f;">${HOTEL.NAME}</h2>
      <p>Dear ${user.name},</p>
      <p>Your booking <strong>#${booking.bookingId}</strong> has been <strong>cancelled</strong>.</p>
      ${refundAmount > 0
        ? `<p>A refund of <strong>₹${refundAmount.toLocaleString('en-IN')}</strong> will be processed within 5-7 business days.</p>`
        : `<p>As per our cancellation policy, no refund is applicable for cancellations within 24 hours of check-in.</p>`}
      <p style="color:#6b7280;font-size:12px;">For support: ${HOTEL.PHONE} | ${HOTEL.EMAIL}</p>
    </div>
  `,
});

const checkoutEmail = (booking, user) => ({
  to: user.email,
  subject: `Checked Out Successfully — ${HOTEL.NAME} | #${booking.bookingId}`,
  html: `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #e5e7eb;border-radius:8px;">
      <h2 style="color:#1e3a5f;">${HOTEL.NAME}</h2>
      <p>Dear ${user.name},</p>
      <p>Your stay for Booking <strong>#${booking.bookingId}</strong> has checked out. Thank you for choosing to stay with us!</p>
      <p>We hope you had a pleasant experience and look forward to welcoming you back in the future.</p>
      <p style="color:#6b7280;font-size:12px;">For any inquiries or feedback: ${HOTEL.PHONE} | ${HOTEL.EMAIL}</p>
    </div>
  `,
});

const otpEmail = (otp, user) => ({
  to: user.email,
  subject: `Password Reset OTP — ${HOTEL.NAME}`,
  html: `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #e5e7eb;border-radius:8px;">
      <h2 style="color:#1e3a5f;">${HOTEL.NAME}</h2>
      <p>Dear ${user.name || 'Guest'},</p>
      <p>We received a request to reset your password. Use the following One-Time Password (OTP) to proceed. This OTP is valid for 10 minutes:</p>
      <div style="text-align:center;margin:24px 0;">
        <span style="font-size:32px;font-weight:bold;letter-spacing:6px;background-color:#f3f4f6;padding:12px 24px;border-radius:8px;border:1px solid #e5e7eb;color:#1e3a5f;">${otp}</span>
      </div>
      <p>If you did not request a password reset, please ignore this email.</p>
      <p style="color:#6b7280;font-size:12px;">Address: ${HOTEL.ADDRESS} | Phone: ${HOTEL.PHONE}</p>
    </div>
  `,
});

module.exports = {
  sendEmail,
  bookingConfirmationEmail,
  cancellationEmail,
  checkoutEmail,
  otpEmail,
};
