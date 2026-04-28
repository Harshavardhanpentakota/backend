'use strict';

const rateLimit = require('express-rate-limit');
const { sendError } = require('../utils/response');

const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000; // 15 min
const max = parseInt(process.env.RATE_LIMIT_MAX, 10) || 100;

const rateLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    sendError(
      res,
      429,
      `Too many requests from this IP. Please try again after ${Math.ceil(windowMs / 60000)} minutes.`
    ),
  skip: (req) => process.env.NODE_ENV === 'test',
});

/** Stricter limiter for auth endpoints */
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    sendError(
      res,
      429,
      'Too many authentication attempts. Please try again after 15 minutes.'
    ),
  skip: (req) => process.env.NODE_ENV === 'test',
});

module.exports = { rateLimiter, authRateLimiter };
