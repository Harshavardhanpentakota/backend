'use strict';

const express = require('express');
const router = express.Router();
const { getStaff, getStaffById, createStaff, updateStaff, deleteStaff } = require('../controllers/staff.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { ROLES, STAFF_ROLES, SHIFT } = require('../constants');
const { validate } = require('../middlewares/validate');
const { body, param } = require('express-validator');

const createStaffValidation = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ min: 2, max: 100 }),
  body('role').notEmpty().withMessage('Role is required').isIn(Object.values(STAFF_ROLES)),
  body('shift').notEmpty().withMessage('Shift is required').isIn(Object.values(SHIFT)),
  body('contact.phone').optional().trim(),
  body('contact.email').optional().isEmail().withMessage('Invalid email'),
];

router.use(authenticate, authorize(ROLES.ADMIN));

router.get('/', getStaff);
router.get('/:id', [param('id').isMongoId()], validate, getStaffById);
router.post('/', createStaffValidation, validate, createStaff);
router.put('/:id', [param('id').isMongoId()], validate, updateStaff);
router.delete('/:id', [param('id').isMongoId()], validate, deleteStaff);

module.exports = router;
