'use strict';

const express = require('express');
const router = express.Router();
const {
  createRazorpayOrder, verifyRazorpayPayment, recordOfflinePayment, getPaymentByBooking,
} = require('../controllers/payment.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { ROLES } = require('../constants');
const { validate } = require('../middlewares/validate');
const { verifyPaymentValidation, offlinePaymentValidation } = require('../validations/payment.validation');
const { param, body } = require('express-validator');

router.use(authenticate);

router.post('/razorpay/order', [body('bookingId').isMongoId().withMessage('Invalid booking ID')], validate, createRazorpayOrder);
router.post('/razorpay/verify', verifyPaymentValidation, validate, verifyRazorpayPayment);
router.post('/offline', authorize(ROLES.ADMIN, ROLES.RECEPTIONIST), offlinePaymentValidation, validate, recordOfflinePayment);
router.get('/:bookingId', [param('bookingId').isMongoId().withMessage('Invalid booking ID')], validate, getPaymentByBooking);

module.exports = router;
