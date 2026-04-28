'use strict';

const express = require('express');
const router = express.Router();
const {
  getDashboard, getRevenueReport, getOccupancyReport, getBookingsByRoomType,
  getStaff, createStaff, updateStaff, deleteStaff,
  getUsers, updateBookingStatus,
  getRoomsAdmin, updateRoomAdmin,
  getSettings, updateSettings,
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

// ── Admin-only from here down ─────────────────────────────────────────────────
router.use(authorize(ROLES.ADMIN));

// Dashboard & reports
router.get('/dashboard', getDashboard);
router.get('/reports/revenue', getRevenueReport);
router.get('/reports/occupancy', getOccupancyReport);
router.get('/reports/bookings-by-room-type', getBookingsByRoomType);

// Staff management
router.get('/staff', getStaff);
router.post('/staff', createStaff);
router.patch('/staff/:id', [param('id').isMongoId()], validate, updateStaff);
router.delete('/staff/:id', [param('id').isMongoId()], validate, deleteStaff);

// Booking management
router.patch('/bookings/:id/status', [param('id').isMongoId(), body('status').notEmpty()], validate, updateBookingStatus);

// Room mutations (admin-only)
router.patch('/rooms/:id', [param('id').isMongoId()], validate, updateRoomAdmin);

// Hotel settings
router.get('/settings', getSettings);
router.patch('/settings', updateSettings);

module.exports = router;
