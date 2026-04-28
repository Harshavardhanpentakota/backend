'use strict';

const mongoose = require('mongoose');
const { PAYMENT_METHOD, PAYMENT_STATUS } = require('../constants');

const paymentSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: [true, 'Booking reference is required'],
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0, 'Amount cannot be negative'],
    },
    method: {
      type: String,
      enum: {
        values: Object.values(PAYMENT_METHOD),
        message: `Payment method must be one of: ${Object.values(PAYMENT_METHOD).join(', ')}`,
      },
      required: [true, 'Payment method is required'],
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
    },
    // Razorpay specific
    razorpayOrderId: {
      type: String,
    },
    razorpayPaymentId: {
      type: String,
    },
    razorpaySignature: {
      type: String,
    },
    transactionId: {
      type: String,
      trim: true,
    },
    refundId: {
      type: String,
    },
    refundAmount: {
      type: Number,
      default: 0,
    },
    refundDate: {
      type: Date,
    },
    paidAt: {
      type: Date,
    },
    failureReason: {
      type: String,
    },
    notes: {
      type: String,
    },
  },
  { timestamps: true }
);

// Indexes
paymentSchema.index({ booking: 1 });
paymentSchema.index({ user: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ razorpayOrderId: 1 });
paymentSchema.index({ transactionId: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
