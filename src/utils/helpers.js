'use strict';

const { PAGINATION } = require('../constants');

/**
 * Parse and validate pagination query params.
 * @param {object} query - express req.query
 * @returns {{ page: number, limit: number, skip: number }}
 */
const parsePagination = (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || PAGINATION.DEFAULT_PAGE);
  const limit = Math.min(
    PAGINATION.MAX_LIMIT,
    Math.max(1, parseInt(query.limit, 10) || PAGINATION.DEFAULT_LIMIT)
  );
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

/**
 * Generate a unique booking ID: BK-YYYYXXXX
 */
const generateBookingId = () => {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `BK-${year}${rand}`;
};

/**
 * Generate a unique invoice number: INV-YYYYMMDD-XXXX
 */
const generateInvoiceNumber = () => {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `INV-${dateStr}-${rand}`;
};

/**
 * Calculate number of nights between two dates.
 * @param {Date|string} checkIn
 * @param {Date|string} checkOut
 * @returns {number}
 */
const calculateNights = (checkIn, checkOut) => {
  const msPerDay = 1000 * 60 * 60 * 24;
  const diff = new Date(checkOut) - new Date(checkIn);
  return Math.max(1, Math.ceil(diff / msPerDay));
};

/**
 * Calculate refund amount based on cancellation policy.
 * @param {number} totalAmount
 * @param {Date|string} checkInDate
 * @param {import('../constants').CANCELLATION_POLICY} policy
 * @returns {{ refundAmount: number, refundPercentage: number }}
 */
const calculateRefund = (totalAmount, checkInDate, policy) => {
  const hoursUntilCheckIn =
    (new Date(checkInDate) - new Date()) / (1000 * 60 * 60);

  if (hoursUntilCheckIn > policy.FULL_REFUND_HOURS) {
    const refundAmount = (totalAmount * policy.REFUND_PERCENTAGE) / 100;
    return { refundAmount, refundPercentage: policy.REFUND_PERCENTAGE };
  }
  return { refundAmount: 0, refundPercentage: 0 };
};

/**
 * Add GST to a base amount.
 * @param {number} baseAmount
 * @param {number} gstPercent
 */
const addGST = (baseAmount, gstPercent = 12) => {
  const tax = (baseAmount * gstPercent) / 100;
  return { subtotal: baseAmount, tax, totalAmount: baseAmount + tax };
};

module.exports = {
  parsePagination,
  generateBookingId,
  generateInvoiceNumber,
  calculateNights,
  calculateRefund,
  addGST,
};
