'use strict';

const express = require('express');
const router = express.Router();
const {
  register, login, refreshToken, logout, getMe, changePassword,
} = require('../controllers/auth.controller');
const { authenticate } = require('../middlewares/auth');
const { authRateLimiter } = require('../middlewares/rateLimiter');
const { validate } = require('../middlewares/validate');
const {
  registerValidation, loginValidation, changePasswordValidation,
} = require('../validations/auth.validation');
const { body } = require('express-validator');

router.post('/register', authRateLimiter, registerValidation, validate, register);
router.post('/login', authRateLimiter, loginValidation, validate, login);
router.post('/refresh', [body('refreshToken').notEmpty().withMessage('Refresh token required')], validate, refreshToken);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, getMe);
router.put('/change-password', authenticate, changePasswordValidation, validate, changePassword);

module.exports = router;
