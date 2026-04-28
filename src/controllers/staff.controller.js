'use strict';

const Staff = require('../models/Staff');
const { sendSuccess, sendError, paginationMeta } = require('../utils/response');
const { parsePagination } = require('../utils/helpers');
const { STAFF_ROLES, SHIFT } = require('../constants');
const { body, param } = require('express-validator');

// GET /api/staff
const getStaff = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { role, shift, search, isActive } = req.query;

    const filter = {};
    if (role) filter.role = role;
    if (shift) filter.shift = shift;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { 'contact.phone': { $regex: search, $options: 'i' } },
      ];
    }

    const [staff, total] = await Promise.all([
      Staff.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Staff.countDocuments(filter),
    ]);

    return sendSuccess(res, 200, 'Staff fetched', staff, paginationMeta(total, page, limit));
  } catch (error) {
    next(error);
  }
};

// GET /api/staff/:id
const getStaffById = async (req, res, next) => {
  try {
    const staff = await Staff.findById(req.params.id);
    if (!staff) return sendError(res, 404, 'Staff member not found');
    return sendSuccess(res, 200, 'Staff member fetched', staff);
  } catch (error) {
    next(error);
  }
};

// POST /api/staff
const createStaff = async (req, res, next) => {
  try {
    const staff = await Staff.create(req.body);
    return sendSuccess(res, 201, 'Staff member created', staff);
  } catch (error) {
    next(error);
  }
};

// PUT /api/staff/:id
const updateStaff = async (req, res, next) => {
  try {
    const staff = await Staff.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!staff) return sendError(res, 404, 'Staff member not found');
    return sendSuccess(res, 200, 'Staff member updated', staff);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/staff/:id  (soft delete)
const deleteStaff = async (req, res, next) => {
  try {
    const staff = await Staff.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!staff) return sendError(res, 404, 'Staff member not found');
    return sendSuccess(res, 200, 'Staff member deactivated');
  } catch (error) {
    next(error);
  }
};

module.exports = { getStaff, getStaffById, createStaff, updateStaff, deleteStaff };
