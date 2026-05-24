'use strict';

const express = require('express');
const router = express.Router();
const {
  createRazorpayOrder, verifyRazorpayPayment, recordOfflinePayment,
  getPaymentByBooking, getAllPayments, refundPayment,
} = require('../controllers/payment.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { ROLES } = require('../constants');
const { validate } = require('../middlewares/validate');
const { verifyPaymentValidation, offlinePaymentValidation } = require('../validations/payment.validation');
const { param, body } = require('express-validator');

router.use(authenticate);

// All payments list (admin + receptionist)
router.get('/', authorize(ROLES.ADMIN, ROLES.RECEPTIONIST), getAllPayments);

// Razorpay flow (users)
router.post('/razorpay/order', [body('bookingId').isMongoId().withMessage('Invalid booking ID')], validate, createRazorpayOrder);
router.post('/razorpay/verify', verifyPaymentValidation, validate, verifyRazorpayPayment);

// Offline payment (admin + receptionist)
router.post('/offline', authorize(ROLES.ADMIN, ROLES.RECEPTIONIST), offlinePaymentValidation, validate, recordOfflinePayment);

// Refund (admin + receptionist)
router.post('/:id/refund',
  authorize(ROLES.ADMIN, ROLES.RECEPTIONIST),
  [param('id').isMongoId().withMessage('Invalid payment ID')],
  validate,
  refundPayment
);

// Payment by booking
router.get('/:bookingId', [param('bookingId').isMongoId().withMessage('Invalid booking ID')], validate, getPaymentByBooking);

module.exports = router;
