'use strict';

const mongoose = require('mongoose');
const { ROOM_TYPES, ROOM_STATUS } = require('../constants');

const roomSchema = new mongoose.Schema(
  {
    roomNumber: {
      type: String,
      required: [true, 'Room number is required'],
      unique: true,
      trim: true,
    },
    floor: {
      type: Number,
      required: [true, 'Floor is required'],
      min: [1, 'Floor must be at least 1'],
      max: [3, 'Hotel has only 3 floors'],
    },
    type: {
      type: String,
      required: [true, 'Room type is required'],
      enum: {
        values: Object.values(ROOM_TYPES),
        message: `Room type must be one of: ${Object.values(ROOM_TYPES).join(', ')}`,
      },
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    capacity: {
      type: Number,
      required: [true, 'Capacity is required'],
      min: [1, 'Capacity must be at least 1'],
      max: [6, 'Capacity cannot exceed 6'],
    },
    size: {
      type: String,
      trim: true,
    },
    beds: {
      type: String,
      trim: true,
    },
    amenities: {
      type: [String],
      default: ['WiFi', 'TV', 'Hot Water'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description must not exceed 500 characters'],
    },
    images: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: Object.values(ROOM_STATUS),
      default: ROOM_STATUS.AVAILABLE,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    rating: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0 },
    },
    lastCleaned: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Indexes for fast availability queries
roomSchema.index({ type: 1, status: 1 });
roomSchema.index({ floor: 1 });
roomSchema.index({ price: 1 });

module.exports = mongoose.model('Room', roomSchema);
