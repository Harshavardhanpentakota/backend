'use strict';

const express = require('express');
const router = express.Router();
const { getInvoiceByBooking, downloadInvoicePDF } = require('../controllers/invoice.controller');
const { authenticate } = require('../middlewares/auth');
const { param } = require('express-validator');
const { validate } = require('../middlewares/validate');

router.use(authenticate);

router.get('/:bookingId', [param('bookingId').isMongoId().withMessage('Invalid booking ID')], validate, getInvoiceByBooking);
router.get('/:bookingId/pdf', [param('bookingId').isMongoId().withMessage('Invalid booking ID')], validate, downloadInvoicePDF);

module.exports = router;
