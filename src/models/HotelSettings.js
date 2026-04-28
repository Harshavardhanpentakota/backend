'use strict';

const mongoose = require('mongoose');

/**
 * Singleton settings document — always upsert with { _id: 'default' }.
 */
const hotelSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'default' },
    // ── GST ───────────────────────────────────────────────────────────────────
    cgstPercentage: { type: Number, default: 6, min: 0, max: 50 },
    sgstPercentage: { type: Number, default: 6, min: 0, max: 50 },
    // ── Advance payment ───────────────────────────────────────────────────────
    advancePaymentPercent: { type: Number, default: 10, min: 0, max: 100 },
    // ── Hotel info ────────────────────────────────────────────────────────────
    hotelName: { type: String, default: 'Hotel Abhitejinn' },
    hotelPhone: { type: String, default: '+91 98765 43210' },
    hotelEmail: { type: String, default: 'info@hotelabhitejinn.com' },
    hotelAddress: { type: String, default: '123 Hotel Street, Mumbai, Maharashtra 400001' },
    hotelTagline: { type: String, default: 'Your home away from home' },
    gstNumber: { type: String, default: '' },
  },
  { timestamps: true }
);

/**
 * Get or create the singleton settings document.
 */
hotelSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findById('default');
  if (!settings) settings = await this.create({ _id: 'default' });
  return settings;
};

module.exports = mongoose.model('HotelSettings', hotelSettingsSchema);
