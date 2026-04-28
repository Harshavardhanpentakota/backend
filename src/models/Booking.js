'use strict';

const mongoose = require('mongoose');
const { BOOKING_STATUS, BOOKING_SOURCE, PAYMENT_STATUS } = require('../constants');

const bookingSchema = new mongoose.Schema(
  {
    bookingId: {
      type: String,
      unique: true,
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
    },
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      required: [true, 'Room is required'],
    },
    checkInDate: {
      type: Date,
      required: [true, 'Check-in date is required'],
    },
    checkOutDate: {
      type: Date,
      required: [true, 'Check-out date is required'],
    },
    actualCheckIn: {
      type: Date,
    },
    actualCheckOut: {
      type: Date,
    },
    guests: {
      type: Number,
      required: [true, 'Number of guests is required'],
      min: [1, 'At least 1 guest required'],
      max: [6, 'Maximum 6 guests allowed'],
    },
    nights: {
      type: Number,
      required: true,
      min: 1,
    },
    subtotal: {
      type: Number,
      required: true,
    },
    tax: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(BOOKING_STATUS),
      default: BOOKING_STATUS.PENDING,
    },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
    },
    source: {
      type: String,
      enum: Object.values(BOOKING_SOURCE),
      default: BOOKING_SOURCE.ONLINE,
    },
    // For offline/phone bookings (created by receptionist/admin)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    guestDetails: {
      name: String,
      email: String,
      phone: String,
      idProof: String,
    },
    specialRequests: {
      type: String,
      maxlength: [300, 'Special requests must not exceed 300 characters'],
    },
    cancellationReason: {
      type: String,
    },
    refundAmount: {
      type: Number,
      default: 0,
    },
    cancellationDate: {
      type: Date,
    },
    // ── Extra charges added during stay ─────────────────────────────────────
    extraCharges: [
      {
        description: { type: String, required: true, trim: true },
        amount: { type: Number, required: true, min: 0 },
        category: {
          type: String,
          enum: ['food', 'laundry', 'room_service', 'minibar', 'transport', 'other'],
          default: 'other',
        },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        addedAt: { type: Date, default: Date.now },
      },
    ],
    // ── Advance payment at check-in ──────────────────────────────────────────
    advancePaid: { type: Number, default: 0 },
    advancePaidAt: { type: Date },
    advancePaymentMethod: {
      type: String,
      enum: ['cash', 'card', 'upi', 'net_banking'],
      default: 'cash',
    },
  },
  { timestamps: true }
);

// Prevent check-out before check-in
bookingSchema.pre('validate', function (next) {
  if (this.checkOutDate <= this.checkInDate) {
    this.invalidate('checkOutDate', 'Check-out date must be after check-in date');
  }
  next();
});

// Indexes
// bookingId is already indexed via unique: true in the schema definition
bookingSchema.index({ user: 1, status: 1 });
bookingSchema.index({ room: 1, checkInDate: 1, checkOutDate: 1 });
bookingSchema.index({ status: 1, paymentStatus: 1 });
bookingSchema.index({ checkInDate: 1, checkOutDate: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
