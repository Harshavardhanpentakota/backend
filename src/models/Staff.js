'use strict';

const mongoose = require('mongoose');
const { STAFF_ROLES, SHIFT } = require('../constants');

const staffSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Staff name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [100, 'Name must not exceed 100 characters'],
    },
    employeeId: {
      type: String,
      unique: true,
      trim: true,
    },
    role: {
      type: String,
      enum: {
        values: Object.values(STAFF_ROLES),
        message: `Role must be one of: ${Object.values(STAFF_ROLES).join(', ')}`,
      },
      required: [true, 'Staff role is required'],
    },
    shift: {
      type: String,
      enum: Object.values(SHIFT),
      required: [true, 'Shift is required'],
    },
    contact: {
      phone: {
        type: String,
        trim: true,
      },
      email: {
        type: String,
        lowercase: true,
        trim: true,
      },
    },
    salary: {
      type: Number,
      min: 0,
    },
    joiningDate: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    address: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
    },
  },
  { timestamps: true }
);

staffSchema.index({ role: 1, shift: 1 });
// employeeId is already indexed via unique: true in the schema definition

// Auto-generate employee ID before saving new staff
staffSchema.pre('save', async function (next) {
  if (this.isNew && !this.employeeId) {
    const count = await mongoose.model('Staff').countDocuments();
    this.employeeId = `EMP-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

module.exports = mongoose.model('Staff', staffSchema);
