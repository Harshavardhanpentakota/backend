'use strict';

const Notification = require('../models/Notification');
const { notificationEmitter } = require('./notificationStream');
const { sendEmail, bookingConfirmationEmail, cancellationEmail } = require('./email');
const User = require('../models/User');
const Room = require('../models/Room');
const logger = require('./logger');

/**
 * Helper to create notifications, emit real-time event, and send emails if infrastructure is present.
 */
const createNotification = async ({ recipientId, recipientRole, title, message, type, metadata }) => {
  try {
    const notification = await Notification.create({
      recipientId: recipientId || null,
      recipientRole: recipientRole || null,
      title,
      message,
      type,
      metadata: metadata || {},
    });

    // Broadcast in real-time
    notificationEmitter.emit('notification', notification);

    // E-mail triggers
    if (recipientId) {
      const user = await User.findById(recipientId);
      if (user && user.email) {
        if (type === 'booking_confirmed') {
          try {
            const booking = metadata.booking;
            const room = metadata.room || (booking && await Room.findById(booking.roomId));
            if (booking && room) {
              const mailOptions = bookingConfirmationEmail(booking, user, room);
              await sendEmail(mailOptions);
            }
          } catch (err) {
            logger.error(`Email notification fail (booking_confirmed): ${err.message}`);
          }
        } else if (type === 'booking_cancelled') {
          try {
            const booking = metadata.booking;
            const refundAmount = metadata.refundAmount || 0;
            if (booking) {
              const mailOptions = cancellationEmail(booking, user, refundAmount);
              await sendEmail(mailOptions);
            }
          } catch (err) {
            logger.error(`Email notification fail (booking_cancelled): ${err.message}`);
          }
        } else if (type === 'payment_successful' || type === 'payment_receipt') {
          try {
            const payment = metadata.payment;
            const booking = metadata.booking;
            if (payment && booking) {
              await sendEmail({
                to: user.email,
                subject: `Payment Receipt — Booking #${booking.bookingId}`,
                html: `
                  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #e5e7eb;border-radius:8px;">
                    <h2 style="color:#1e3a5f;">Payment Successful</h2>
                    <p>Dear ${user.name},</p>
                    <p>We have received your payment of <strong>₹${payment.amount}</strong> for booking ID <strong>#${booking.bookingId}</strong>.</p>
                    <p>Transaction ID: <strong>${payment.transactionId || 'N/A'}</strong></p>
                    <p>Payment Method: <strong>${payment.paymentMethod || 'N/A'}</strong></p>
                  </div>
                `
              });
            }
          } catch (err) {
            logger.error(`Email notification fail (payment_receipt): ${err.message}`);
          }
        } else if (type === 'booking_checked_in') {
          try {
            const booking = metadata.booking;
            if (booking) {
              await sendEmail({
                to: user.email,
                subject: `Checked-In Successfully — Booking #${booking.bookingId}`,
                html: `
                  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #e5e7eb;border-radius:8px;">
                    <h2 style="color:#1e3a5f;">Checked In</h2>
                    <p>Dear ${user.name},</p>
                    <p>You have successfully checked into room <strong>${metadata.roomNumber || ''}</strong>.</p>
                    <p>We hope you enjoy your stay!</p>
                  </div>
                `
              });
            }
          } catch (err) {
            logger.error(`Email notification fail (booking_checked_in): ${err.message}`);
          }
        }
      }
    }

    return notification;
  } catch (error) {
    logger.error(`Failed to create notification: ${error.message}`);
    return null;
  }
};

module.exports = {
  createNotification,
};
