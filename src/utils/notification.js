'use strict';

const Notification = require('../models/Notification');
const { notificationEmitter } = require('./notificationStream');
const { sendEmail, bookingConfirmationEmail, cancellationEmail, checkoutEmail } = require('./email');
const User = require('../models/User');
const Room = require('../models/Room');
const { HOTEL } = require('../constants');
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
            const room = metadata.room || (booking && await Room.findById(booking.room));
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
        } else if (type === 'booking_checked_out') {
          try {
            const booking = metadata.booking;
            if (booking) {
              const mailOptions = checkoutEmail(booking, user);
              await sendEmail(mailOptions);
            }
          } catch (err) {
            logger.error(`Email notification fail (booking_checked_out): ${err.message}`);
          }
        }
      }
    }

    if (recipientRole) {
      // Find all active users with this role and email them in a non-blocking way
      User.find({ role: recipientRole, isActive: true })
        .then((staffUsers) => {
          staffUsers.forEach((staff) => {
            if (staff.email) {
              sendEmail({
                to: staff.email,
                subject: `${title} — ${HOTEL.NAME}`,
                html: `
                  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #e5e7eb;border-radius:8px;">
                    <h2 style="color:#1e3a5f;">${HOTEL.NAME} — Notification</h2>
                    <p>Dear ${staff.name},</p>
                    <p>A new notification has been posted for your role (<strong>${recipientRole}</strong>):</p>
                    <div style="background-color:#f3f4f6;padding:16px;border-radius:8px;border:1px solid #e5e7eb;margin:16px 0;">
                      <strong style="color:#1e3a5f;font-size:16px;">${title}</strong>
                      <p style="margin-top:8px;font-size:14px;color:#374151;">${message}</p>
                    </div>
                    <p style="color:#6b7280;font-size:12px;">This is an automated notification. Please log in to the admin system for details.</p>
                  </div>
                `
              }).catch((err) => {
                logger.error(`Failed to send role email to ${staff.email}: ${err.message}`);
              });
            }
          });
        })
        .catch((err) => {
          logger.error(`Failed to find staff users for role ${recipientRole}: ${err.message}`);
        });
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
