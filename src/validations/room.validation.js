'use strict';

const { body, query, param } = require('express-validator');
const { ROOM_TYPES, ROOM_STATUS } = require('../constants');

const createRoomValidation = [
  body('roomNumber')
    .trim()
    .notEmpty().withMessage('Room number is required'),

  body('floor')
    .notEmpty().withMessage('Floor is required')
    .isInt({ min: 1, max: 3 }).withMessage('Floor must be between 1 and 3'),

  body('type')
    .notEmpty().withMessage('Room type is required')
    .isIn(Object.values(ROOM_TYPES)).withMessage(`Type must be one of: ${Object.values(ROOM_TYPES).join(', ')}`),

  body('price')
    .notEmpty().withMessage('Price is required')
    .isFloat({ min: 0 }).withMessage('Price must be a non-negative number'),

  body('capacity')
    .notEmpty().withMessage('Capacity is required')
    .isInt({ min: 1, max: 6 }).withMessage('Capacity must be between 1 and 6'),

  body('amenities')
    .optional()
    .isArray().withMessage('Amenities must be an array'),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Description must not exceed 500 characters'),
];

const updateRoomValidation = [
  param('id').isMongoId().withMessage('Invalid room ID'),

  body('floor')
    .optional()
    .isInt({ min: 1, max: 3 }).withMessage('Floor must be between 1 and 3'),

  body('type')
    .optional()
    .isIn(Object.values(ROOM_TYPES)).withMessage(`Type must be one of: ${Object.values(ROOM_TYPES).join(', ')}`),

  body('price')
    .optional()
    .isFloat({ min: 0 }).withMessage('Price must be a non-negative number'),

  body('status')
    .optional()
    .isIn(Object.values(ROOM_STATUS)).withMessage(`Status must be one of: ${Object.values(ROOM_STATUS).join(', ')}`),
];

const roomAvailabilityValidation = [
  query('checkIn')
    .notEmpty().withMessage('Check-in date is required')
    .isISO8601().withMessage('Check-in must be a valid date'),

  query('checkOut')
    .notEmpty().withMessage('Check-out date is required')
    .isISO8601().withMessage('Check-out must be a valid date'),

  query('type')
    .optional()
    .isIn(Object.values(ROOM_TYPES)).withMessage(`Type must be one of: ${Object.values(ROOM_TYPES).join(', ')}`),

  query('guests')
    .optional()
    .isInt({ min: 1, max: 6 }).withMessage('Guests must be between 1 and 6'),
];

module.exports = { createRoomValidation, updateRoomValidation, roomAvailabilityValidation };
