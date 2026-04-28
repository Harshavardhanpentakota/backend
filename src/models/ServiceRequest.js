'use strict';

const mongoose = require('mongoose');
const { SERVICE_TYPE, SERVICE_STATUS } = require('../constants');

const serviceRequestSchema = new mongoose.Schema(
  {
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      required: [true, 'Room is required'],
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    type: {
      type: String,
      enum: {
        values: Object.values(SERVICE_TYPE),
        message: `Service type must be one of: ${Object.values(SERVICE_TYPE).join(', ')}`,
      },
      required: [true, 'Service type is required'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, 'Description must not exceed 300 characters'],
    },
    status: {
      type: String,
      enum: Object.values(SERVICE_STATUS),
      default: SERVICE_STATUS.PENDING,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
    },
    resolvedAt: {
      type: Date,
    },
    notes: {
      type: String,
    },
  },
  { timestamps: true }
);

serviceRequestSchema.index({ room: 1, status: 1 });
serviceRequestSchema.index({ type: 1, status: 1 });

module.exports = mongoose.model('ServiceRequest', serviceRequestSchema);
