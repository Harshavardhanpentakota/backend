'use strict';

const express = require('express');
const router = express.Router();
const {
  getRooms, getAvailableRooms, getRoomById, getRoomBookedDates,
  createRoom, updateRoom, deleteRoom, updateRoomStatus,
} = require('../controllers/room.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { ROLES } = require('../constants');
const { validate } = require('../middlewares/validate');
const {
  createRoomValidation, updateRoomValidation, roomAvailabilityValidation,
} = require('../validations/room.validation');
const { param, body } = require('express-validator');

// Public routes
router.get('/', getRooms);
router.get('/available', roomAvailabilityValidation, validate, getAvailableRooms);
router.get('/:id/booked-dates', [param('id').isMongoId().withMessage('Invalid room ID')], validate, getRoomBookedDates);
router.get('/:id', [param('id').isMongoId().withMessage('Invalid room ID')], validate, getRoomById);

// Admin-only
router.post('/', authenticate, authorize(ROLES.ADMIN), createRoomValidation, validate, createRoom);
router.put('/:id', authenticate, authorize(ROLES.ADMIN), updateRoomValidation, validate, updateRoom);
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), [
  param('id').isMongoId().withMessage('Invalid room ID'),
], validate, deleteRoom);

// Admin + Receptionist
router.patch('/:id/status', authenticate, authorize(ROLES.ADMIN, ROLES.RECEPTIONIST), [
  param('id').isMongoId().withMessage('Invalid room ID'),
  body('status').notEmpty().withMessage('Status is required'),
], validate, updateRoomStatus);

module.exports = router;
