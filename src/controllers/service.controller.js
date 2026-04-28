'use strict';

const ServiceRequest = require('../models/ServiceRequest');
const { sendSuccess, sendError, paginationMeta } = require('../utils/response');
const { parsePagination } = require('../utils/helpers');
const { SERVICE_TYPE, SERVICE_STATUS } = require('../constants');

// POST /api/services
const createServiceRequest = async (req, res, next) => {
  try {
    const { roomId, bookingId, type, description, priority } = req.body;

    const request = await ServiceRequest.create({
      room: roomId,
      booking: bookingId,
      requestedBy: req.user._id,
      type,
      description,
      priority,
    });

    return sendSuccess(res, 201, 'Service request created', request);
  } catch (error) {
    next(error);
  }
};

// GET /api/services
const getServiceRequests = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { type, status, roomId } = req.query;

    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (roomId) filter.room = roomId;

    const [requests, total] = await Promise.all([
      ServiceRequest.find(filter)
        .populate('room', 'roomNumber floor')
        .populate('requestedBy', 'name email')
        .populate('assignedTo', 'name role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      ServiceRequest.countDocuments(filter),
    ]);

    return sendSuccess(res, 200, 'Service requests fetched', requests, paginationMeta(total, page, limit));
  } catch (error) {
    next(error);
  }
};

// PATCH /api/services/:id/status
const updateServiceStatus = async (req, res, next) => {
  try {
    const { status, assignedTo } = req.body;

    const updates = { status };
    if (assignedTo) updates.assignedTo = assignedTo;
    if (status === SERVICE_STATUS.COMPLETED) updates.resolvedAt = new Date();

    const request = await ServiceRequest.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    if (!request) return sendError(res, 404, 'Service request not found');
    return sendSuccess(res, 200, 'Service request updated', request);
  } catch (error) {
    next(error);
  }
};

module.exports = { createServiceRequest, getServiceRequests, updateServiceStatus };
