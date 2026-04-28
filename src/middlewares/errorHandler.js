'use strict';

const logger = require('../utils/logger');

/**
 * Centralised error handling middleware.
 * Must be the LAST middleware registered in app.js.
 */
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let errors = null;

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    statusCode = 422;
    message = 'Validation failed';
    errors = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0];
    message = `${field ? `'${field}'` : 'A value'} already exists. Please use a different value.`;
  }

  // Mongoose cast error (invalid ObjectId)
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid value for field '${err.path}': ${err.value}`;
  }

  // JWT errors (should be caught in auth middleware but guard here too)
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token.';
  }
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token has expired.';
  }

  // Log server errors only
  if (statusCode >= 500) {
    logger.error(`[${req.method}] ${req.originalUrl} — ${statusCode} — ${message}`, {
      stack: err.stack,
      body: req.body,
      params: req.params,
      query: req.query,
      user: req.user?._id,
    });
  } else {
    logger.warn(`[${req.method}] ${req.originalUrl} — ${statusCode} — ${message}`);
  }

  const response = {
    success: false,
    message,
  };

  if (errors) response.errors = errors;

  // Include stack trace in development only
  if (process.env.NODE_ENV === 'development' && err.stack) {
    response.stack = err.stack;
  }

  return res.status(statusCode).json(response);
};

/**
 * 404 handler — must be registered BEFORE errorHandler.
 */
const notFound = (req, res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};

module.exports = { errorHandler, notFound };
