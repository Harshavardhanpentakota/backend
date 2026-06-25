'use strict';

require('dotenv').config();

process.env.NODE_ENV = 'test';
if (process.env.MONGODB_URI) {
  process.env.MONGODB_URI = process.env.MONGODB_URI.replace('/hotel-management', '/hotel-management-test');
}

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const Booking = require('../src/models/Booking');
const Payment = require('../src/models/Payment');
const ActivityLog = require('../src/models/ActivityLog');
const { generateAccessToken } = require('../src/utils/jwt');
const { ROLES } = require('../src/constants');

describe('Admin Bulk Data Clearance Endpoint Tests', () => {
  let adminToken;
  let receptionistToken;
  let adminUser;
  let receptionistUser;

  beforeAll(async () => {
    await connectDB();

    // Clean up
    await User.deleteMany({});
    await Booking.deleteMany({});
    await Payment.deleteMany({});
    await ActivityLog.deleteMany({});

    // Create Admin
    adminUser = await User.create({
      name: 'Super Admin',
      email: 'admin@clear.com',
      phone: '9999999999',
      password: 'password123',
      role: ROLES.ADMIN,
      isActive: true,
    });
    adminToken = generateAccessToken({ id: adminUser._id });

    // Create Receptionist
    receptionistUser = await User.create({
      name: 'Receptionist Clear',
      email: 'reception@clear.com',
      phone: '8888888888',
      password: 'password123',
      role: ROLES.RECEPTIONIST,
      isActive: true,
    });
    receptionistToken = generateAccessToken({ id: receptionistUser._id });
  });

  afterAll(async () => {
    await User.deleteMany({});
    await Booking.deleteMany({});
    await Payment.deleteMany({});
    await ActivityLog.deleteMany({});
    await mongoose.disconnect();
  });

  it('should restrict clear-data route to Admin role only', async () => {
    const res = await request(app)
      .post('/api/admin/clear-data')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({
        dataTypes: ['payments'],
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        password: 'password123'
      });

    expect(res.status).toBe(403);
  });

  it('should validate request body parameters', async () => {
    const res = await request(app)
      .post('/api/admin/clear-data')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dataTypes: [], // Should fail validation (must not be empty)
        startDate: 'invalid-date',
        endDate: '2026-06-30',
        password: '' // Should fail validation (required)
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('should fail with incorrect password', async () => {
    const res = await request(app)
      .post('/api/admin/clear-data')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dataTypes: ['payments'],
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        password: 'wrongpassword'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Incorrect password');
  });

  it('should successfully clear selected data types and log activity history', async () => {
    // Create guest
    const guestUser = await User.create({
      name: 'Guest Clear',
      email: 'guest@clear.com',
      phone: '7777777777',
      password: 'password123',
      role: ROLES.USER,
      isActive: true,
    });

    // Create payment in range
    const payment = await Payment.create({
      booking: new mongoose.Types.ObjectId(),
      user: guestUser._id,
      amount: 5000,
      method: 'cash',
      status: 'paid',
    });

    // Run clearance
    const res = await request(app)
      .post('/api/admin/clear-data')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dataTypes: ['payments', 'userData'],
        startDate: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        endDate: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
        password: 'password123'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.payments).toBe(1);
    expect(res.body.data.userData).toBe(1);

    // Verify payment is soft-deleted
    // Note: Payment find queries automatically exclude isDeleted: true records in search tests
    const dbPayment = await Payment.findById(payment._id);
    expect(dbPayment).toBeNull();

    // Verify guest user is soft-deleted
    const dbUser = await User.findById(guestUser._id);
    expect(dbUser).toBeNull();

    // Verify admin activity log was written
    const logs = await ActivityLog.find({ action: 'Data Cleared by Admin' });
    expect(logs.length).toBe(1);
    expect(logs[0].userName).toBe(adminUser.name);
  });

  it('should successfully clear data irrespective of dates when clearAllDates is true', async () => {
    // Create guest
    const guestUser = await User.create({
      name: 'Guest AllTime',
      email: 'guestall@clear.com',
      phone: '6666666666',
      password: 'password123',
      role: ROLES.USER,
      isActive: true,
    });

    // Create payment
    const payment = await Payment.create({
      booking: new mongoose.Types.ObjectId(),
      user: guestUser._id,
      amount: 15000,
      method: 'card',
      status: 'paid',
    });

    // Run clearance with clearAllDates: true
    const res = await request(app)
      .post('/api/admin/clear-data')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dataTypes: ['payments', 'userData'],
        clearAllDates: true,
        password: 'password123'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify payment is soft-deleted
    const dbPayment = await Payment.findById(payment._id);
    expect(dbPayment).toBeNull();

    // Verify guest user is soft-deleted
    const dbUser = await User.findById(guestUser._id);
    expect(dbUser).toBeNull();
  });
});
