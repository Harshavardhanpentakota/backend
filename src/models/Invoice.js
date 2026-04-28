'use strict';

const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
    },
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      required: true,
    },
    // ── Room charges ──────────────────────────────────────────────────────────
    roomSubtotal: { type: Number, required: true },   // room price × nights (pre-tax)
    // ── Extra charges (food, laundry, etc.) ──────────────────────────────────
    extraCharges: [
      {
        description: { type: String, required: true },
        amount: { type: Number, required: true },
        category: { type: String, default: 'other' },
      },
    ],
    extraChargesTotal: { type: Number, default: 0 },
    // ── Tax breakdown ─────────────────────────────────────────────────────────
    subtotal: { type: Number, required: true },       // roomSubtotal + extraChargesTotal
    cgstPercentage: { type: Number, default: 6 },
    sgstPercentage: { type: Number, default: 6 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },               // cgst + sgst
    totalAmount: { type: Number, required: true },    // subtotal + tax
    // ── Payment summary ───────────────────────────────────────────────────────
    advancePaid: { type: Number, default: 0 },
    advancePaymentMethod: { type: String, default: 'cash' },
    balanceDue: { type: Number, default: 0 },         // totalAmount - advancePaid
    balancePaymentMethod: { type: String, default: 'cash' },
    // ── Meta ──────────────────────────────────────────────────────────────────
    generatedAt: { type: Date, default: Date.now },
    pdfPath: { type: String },
    notes: { type: String },
  },
  { timestamps: true }
);

// Indexes
// invoiceNumber is already indexed via unique: true in the schema definition
invoiceSchema.index({ booking: 1 });
invoiceSchema.index({ user: 1 });

module.exports = mongoose.model('Invoice', invoiceSchema);
