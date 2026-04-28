'use strict';

const express = require('express');
const router = express.Router();
const { createServiceRequest, getServiceRequests, updateServiceStatus } = require('../controllers/service.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { ROLES, SERVICE_TYPE, SERVICE_STATUS } = require('../constants');
const { validate } = require('../middlewares/validate');
const { body, param } = require('express-validator');

router.use(authenticate);

router.post('/', [
  body('roomId').notEmpty().isMongoId().withMessage('Invalid room ID'),
  body('type').notEmpty().isIn(Object.values(SERVICE_TYPE)).withMessage('Invalid service type'),
  body('description').optional().trim().isLength({ max: 300 }),
  body('priority').optional().isIn(['low', 'medium', 'high']),
], validate, createServiceRequest);

router.get('/', authorize(ROLES.ADMIN, ROLES.RECEPTIONIST), getServiceRequests);

router.patch('/:id/status', authorize(ROLES.ADMIN, ROLES.RECEPTIONIST), [
  param('id').isMongoId(),
  body('status').notEmpty().isIn(Object.values(SERVICE_STATUS)),
], validate, updateServiceStatus);

module.exports = router;
