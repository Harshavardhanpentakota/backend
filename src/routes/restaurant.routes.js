'use strict';

const express = require('express');
const router = express.Router();
const { createOrder, getOrders, updateOrderStatus } = require('../controllers/restaurant.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { ROLES, ORDER_STATUS } = require('../constants');
const { validate } = require('../middlewares/validate');
const { body, param } = require('express-validator');

router.use(authenticate);

router.post('/orders', [
  body('roomId').notEmpty().isMongoId().withMessage('Invalid room ID'),
  body('items').isArray({ min: 1 }).withMessage('At least one item required'),
  body('items.*.name').notEmpty().withMessage('Item name is required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('items.*.price').isFloat({ min: 0 }).withMessage('Price must be non-negative'),
  body('specialInstructions').optional().trim().isLength({ max: 200 }),
], validate, createOrder);

router.get('/orders', getOrders);

router.patch('/orders/:id/status', authorize(ROLES.ADMIN, ROLES.RECEPTIONIST), [
  param('id').isMongoId(),
  body('status').notEmpty().isIn(Object.values(ORDER_STATUS)),
], validate, updateOrderStatus);

module.exports = router;
