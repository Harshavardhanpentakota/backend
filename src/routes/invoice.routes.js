'use strict';

const express = require('express');
const router = express.Router();
const { getInvoiceByBooking, downloadInvoicePDF, listInvoices, sendInvoiceEmail } = require('../controllers/invoice.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { ROLES } = require('../constants');
const { param } = require('express-validator');
const { validate } = require('../middlewares/validate');

router.use(authenticate);

// List all invoices — admin & receptionist only
router.get('/', authorize(ROLES.ADMIN, ROLES.RECEPTIONIST), listInvoices);

// Per-booking routes (bookingId is the Mongo _id of the Booking document)
router.get('/:bookingId', [param('bookingId').isMongoId().withMessage('Invalid booking ID')], validate, getInvoiceByBooking);
router.get('/:bookingId/pdf', [param('bookingId').isMongoId().withMessage('Invalid booking ID')], validate, downloadInvoicePDF);
router.post('/:bookingId/email', authorize(ROLES.ADMIN, ROLES.RECEPTIONIST), [param('bookingId').isMongoId().withMessage('Invalid booking ID')], validate, sendInvoiceEmail);

module.exports = router;
