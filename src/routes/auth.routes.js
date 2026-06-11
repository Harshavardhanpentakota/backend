const express = require('express');
const router = express.Router();
const {
  register, login, refreshToken, logout, getMe, changePassword,
  forgotPassword, resetPassword,
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

router.post('/forgot-password', authRateLimiter, [
  body('email').isEmail().withMessage('Please provide a valid email address')
], validate, forgotPassword);

router.post('/reset-password', authRateLimiter, [
  body('email').isEmail().withMessage('Please provide a valid email address'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
], validate, resetPassword);

module.exports = router;
