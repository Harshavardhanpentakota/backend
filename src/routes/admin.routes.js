'use strict';

const express = require('express');
const router = express.Router();
const {
  getDashboard, getRevenueReport, getOccupancyReport, getBookingsByRoomType,
  getStaff, createStaff, updateStaff, deleteStaff,
  getUsers, changeUserPassword, updateBookingStatus,
  getRoomsAdmin, updateRoomAdmin, updateRoomPricing,
  getActiveGuests, changeGuestRoom,
  getSettings, updateSettings,
  getActivityLogs, exportActivityLogs,
  deleteBooking, deletePayment, deleteInvoice, deleteUser, clearDataAdmin,
} = require('../controllers/admin.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { ROLES } = require('../constants');
const { param, body } = require('express-validator');
const { validate } = require('../middlewares/validate');

// All routes require authentication
router.use(authenticate);

// ── Shared: admin + receptionist ─────────────────────────────────────────────
// GET rooms & users are needed by receptionist (Allocation, Guests pages)
router.get('/rooms', authorize(ROLES.ADMIN, ROLES.RECEPTIONIST), getRoomsAdmin);
router.get('/users', authorize(ROLES.ADMIN, ROLES.RECEPTIONIST), getUsers);
// Active guests — receptionist needs this for check-in/out operations
router.get('/active-guests', authorize(ROLES.ADMIN, ROLES.RECEPTIONIST), getActiveGuests);
router.patch('/bookings/:id/change-room', authorize(ROLES.ADMIN, ROLES.RECEPTIONIST), [param('id').isMongoId(), body('newRoomId').isMongoId()], validate, changeGuestRoom);

// ── Admin-only from here down ─────────────────────────────────────────────────
router.use(authorize(ROLES.ADMIN));

// Dashboard & reports
router.get('/dashboard', getDashboard);
router.get('/reports/revenue', getRevenueReport);
router.get('/reports/occupancy', getOccupancyReport);
router.get('/reports/bookings-by-room-type', getBookingsByRoomType);

// Activity logs
router.get('/activity-logs', getActivityLogs);
router.get('/activity-logs/export', exportActivityLogs);

// Staff management
router.get('/staff', getStaff);
router.post('/staff', createStaff);
router.patch('/staff/:id', [param('id').isMongoId()], validate, updateStaff);
router.delete('/staff/:id', [param('id').isMongoId()], validate, deleteStaff);

// User password management
router.patch('/users/:id/password', [
  param('id').isMongoId().withMessage('Invalid user ID'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
], validate, changeUserPassword);

// Booking management
router.patch('/bookings/:id/status', [param('id').isMongoId(), body('status').notEmpty()], validate, updateBookingStatus);

// Room mutations (admin-only)
router.patch('/rooms/pricing', updateRoomPricing);
router.patch('/rooms/:id', [param('id').isMongoId()], validate, updateRoomAdmin);

// Record deletions (admin-only)
router.delete('/bookings/:id', [param('id').isMongoId()], validate, deleteBooking);
router.delete('/payments/:id', [param('id').isMongoId()], validate, deletePayment);
router.delete('/invoices/:id', [param('id').isMongoId()], validate, deleteInvoice);
router.delete('/users/:id', [param('id').isMongoId()], validate, deleteUser);

// Bulk data management (admin-only)
router.post('/clear-data', [
  body('dataTypes').isArray({ min: 1 }).withMessage('At least one data type must be selected'),
  body('clearAllDates').isBoolean().optional(),
  body('startDate').custom((value, { req }) => {
    if (!req.body.clearAllDates && !value) {
      throw new Error('Start date is required when clearAllDates is false');
    }
    if (value && isNaN(Date.parse(value))) {
      throw new Error('Start date must be a valid date');
    }
    return true;
  }),
  body('endDate').custom((value, { req }) => {
    if (!req.body.clearAllDates && !value) {
      throw new Error('End date is required when clearAllDates is false');
    }
    if (value && isNaN(Date.parse(value))) {
      throw new Error('End date must be a valid date');
    }
    return true;
  }),
  body('password').notEmpty().withMessage('Password verification is required')
], validate, clearDataAdmin);

module.exports = router;
