'use strict';

const express = require('express');
const router = express.Router();
const {
  createOfflineBooking, getBookingDetail, checkIn, checkOut,
  addExtraCharge, removeExtraCharge, getTodayActivity,
} = require('../controllers/receptionist.controller');
const { getBookings } = require('../controllers/booking.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { ROLES } = require('../constants');
const { validate } = require('../middlewares/validate');
const { offlineBookingValidation } = require('../validations/booking.validation');
const { body, param } = require('express-validator');

router.use(authenticate, authorize(ROLES.ADMIN, ROLES.RECEPTIONIST));

router.get('/today', getTodayActivity);
router.get('/bookings', getBookings);
router.get('/bookings/:bookingId', getBookingDetail);
router.post('/book', offlineBookingValidation, validate, createOfflineBooking);
router.post('/checkin', [body('bookingId').notEmpty()], validate, checkIn);
router.post('/checkout', [body('bookingId').notEmpty()], validate, checkOut);
router.post(
  '/bookings/:bookingId/charges',
  [body('description').notEmpty(), body('amount').isFloat({ min: 0.01 })],
  validate,
  addExtraCharge
);
router.delete(
  '/bookings/:bookingId/charges/:chargeId',
  [param('chargeId').notEmpty()],
  validate,
  removeExtraCharge
);

module.exports = router;
