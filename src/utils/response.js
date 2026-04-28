'use strict';

/**
 * Sends a consistent success JSON response.
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {string} message
 * @param {object|null} data
 * @param {object|null} meta  – pagination metadata etc.
 */
const sendSuccess = (res, statusCode = 200, message = 'Success', data = null, meta = null) => {
  const payload = { success: true, message };
  if (data !== null) payload.data = data;
  if (meta !== null) payload.meta = meta;
  return res.status(statusCode).json(payload);
};

/**
 * Sends a consistent error JSON response.
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {string} message
 * @param {object|null} errors
 */
const sendError = (res, statusCode = 500, message = 'Internal Server Error', errors = null) => {
  const payload = { success: false, message };
  if (errors !== null) payload.errors = errors;
  return res.status(statusCode).json(payload);
};

/**
 * Build pagination metadata object.
 */
const paginationMeta = (total, page, limit) => ({
  total,
  page: Number(page),
  limit: Number(limit),
  totalPages: Math.ceil(total / limit),
  hasNextPage: page * limit < total,
  hasPrevPage: page > 1,
});

module.exports = { sendSuccess, sendError, paginationMeta };
