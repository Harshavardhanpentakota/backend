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

// Hotel settings
router.get('/settings', getSettings);
router.patch('/settings', updateSettings);

module.exports = router;
