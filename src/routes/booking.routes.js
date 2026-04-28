'use strict';

const express = require('express');
const router = express.Router();
const {
  createBooking, getBookings, getBookingById, cancelBooking,
} = require('../controllers/booking.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { ROLES } = require('../constants');
const { validate } = require('../middlewares/validate');
const {
  createBookingValidation, cancelBookingValidation,
} = require('../validations/booking.validation');
const { param } = require('express-validator');

// All routes require authentication
router.use(authenticate);

router.post('/', createBookingValidation, validate, createBooking);
router.get('/', getBookings);
router.get('/:id', [param('id').isMongoId().withMessage('Invalid booking ID')], validate, getBookingById);
router.put('/:id/cancel', cancelBookingValidation, validate, cancelBooking);

module.exports = router;
