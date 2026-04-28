'use strict';

const { validationResult } = require('express-validator');
const { sendError } = require('../utils/response');

/**
 * Run after express-validator chains.
 * Returns 422 with all field errors if validation fails.
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map((e) => ({
      field: e.path,
      message: e.msg,
    }));
    return sendError(res, 422, 'Validation failed', formattedErrors);
  }
  next();
};

module.exports = { validate };
