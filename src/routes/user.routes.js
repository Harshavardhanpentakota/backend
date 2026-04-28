'use strict';

const express = require('express');
const router = express.Router();
const {
  getProfile, updateProfile, getMyBookings, getAllUsers, getUserById, toggleUserStatus,
} = require('../controllers/user.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { ROLES } = require('../constants');
const { body, param } = require('express-validator');
const { validate } = require('../middlewares/validate');

// Authenticated user routes
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, [
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('phone').optional().trim(),
], validate, updateProfile);
router.get('/bookings', authenticate, getMyBookings);

// Admin-only user management
router.get('/', authenticate, authorize(ROLES.ADMIN), getAllUsers);
router.get('/:id', authenticate, authorize(ROLES.ADMIN), [
  param('id').isMongoId().withMessage('Invalid user ID'),
], validate, getUserById);
router.patch('/:id/status', authenticate, authorize(ROLES.ADMIN), [
  param('id').isMongoId().withMessage('Invalid user ID'),
], validate, toggleUserStatus);

module.exports = router;
