'use strict';

const { body } = require('express-validator');
const { PAYMENT_METHOD } = require('../constants');

const verifyPaymentValidation = [
  body('bookingId')
    .notEmpty().withMessage('Booking ID is required')
    .isMongoId().withMessage('Invalid booking ID'),

  body('razorpayOrderId')
    .notEmpty().withMessage('Razorpay order ID is required'),

  body('razorpayPaymentId')
    .notEmpty().withMessage('Razorpay payment ID is required'),

  body('razorpaySignature')
    .notEmpty().withMessage('Razorpay signature is required'),
];

const offlinePaymentValidation = [
  body('bookingId')
    .notEmpty().withMessage('Booking ID is required')
    .isMongoId().withMessage('Invalid booking ID'),

  body('method')
    .notEmpty().withMessage('Payment method is required')
    .isIn([PAYMENT_METHOD.CASH, PAYMENT_METHOD.CARD, PAYMENT_METHOD.UPI])
    .withMessage('Offline payment method must be cash, card, or upi'),

  body('transactionId')
    .optional()
    .trim(),
];

module.exports = { verifyPaymentValidation, offlinePaymentValidation };
