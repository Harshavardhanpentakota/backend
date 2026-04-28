'use strict';

const { body, param } = require('express-validator');
const { PAYMENT_METHOD, BOOKING_SOURCE } = require('../constants');

const createBookingValidation = [
  body('roomId')
    .notEmpty().withMessage('Room ID is required')
    .isMongoId().withMessage('Invalid room ID'),

  body('checkInDate')
    .notEmpty().withMessage('Check-in date is required')
    .isISO8601().withMessage('Check-in must be a valid date')
    .custom((value) => {
      if (new Date(value) < new Date(new Date().setHours(0, 0, 0, 0))) {
        throw new Error('Check-in date cannot be in the past');
      }
      return true;
    }),

  body('checkOutDate')
    .notEmpty().withMessage('Check-out date is required')
    .isISO8601().withMessage('Check-out must be a valid date')
    .custom((value, { req }) => {
      if (new Date(value) <= new Date(req.body.checkInDate)) {
        throw new Error('Check-out date must be after check-in date');
      }
      return true;
    }),

  body('guests')
    .notEmpty().withMessage('Number of guests is required')
    .isInt({ min: 1, max: 6 }).withMessage('Guests must be between 1 and 6'),

  body('paymentMethod')
    .optional()
    .isIn(Object.values(PAYMENT_METHOD)).withMessage(`Payment method must be one of: ${Object.values(PAYMENT_METHOD).join(', ')}`),

  body('specialRequests')
    .optional()
    .trim()
    .isLength({ max: 300 }).withMessage('Special requests must not exceed 300 characters'),
];

const offlineBookingValidation = [
  ...createBookingValidation,

  body('source')
    .optional()
    .isIn(Object.values(BOOKING_SOURCE)).withMessage(`Source must be one of: ${Object.values(BOOKING_SOURCE).join(', ')}`),

  body('guestDetails.name')
    .notEmpty().withMessage('Guest name is required'),

  body('guestDetails.phone')
    .notEmpty().withMessage('Guest phone is required'),

  body('guestDetails.email')
    .optional()
    .isEmail().withMessage('Invalid guest email'),

  body('guestDetails.idProof')
    .optional()
    .trim(),
];

const cancelBookingValidation = [
  param('id').isMongoId().withMessage('Invalid booking ID'),

  body('reason')
    .optional()
    .trim()
    .isLength({ max: 300 }).withMessage('Reason must not exceed 300 characters'),
];

module.exports = {
  createBookingValidation,
  offlineBookingValidation,
  cancelBookingValidation,
};
