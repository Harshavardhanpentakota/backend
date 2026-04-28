'use strict';

const mongoose = require('mongoose');
const { ORDER_STATUS } = require('../constants');

const menuItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const restaurantOrderSchema = new mongoose.Schema(
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
    orderedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    items: {
      type: [menuItemSchema],
      required: [true, 'Order must have at least one item'],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'Order must contain at least one item',
      },
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    tax: {
      type: Number,
      default: 0,
    },
    totalPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.PENDING,
    },
    isVeg: {
      type: Boolean,
      default: true,
      description: 'Hotel serves pure veg food only',
    },
    specialInstructions: {
      type: String,
      maxlength: [200, 'Instructions must not exceed 200 characters'],
    },
    deliveredAt: {
      type: Date,
    },
    notes: {
      type: String,
    },
  },
  { timestamps: true }
);

restaurantOrderSchema.index({ room: 1, status: 1 });
restaurantOrderSchema.index({ booking: 1 });

module.exports = mongoose.model('RestaurantOrder', restaurantOrderSchema);
