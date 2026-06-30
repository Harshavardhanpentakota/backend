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
const HotelSettings = require('../src/models/HotelSettings');
const { generateAccessToken } = require('../src/utils/jwt');
const { ROLES } = require('../src/constants');

describe('Admin & Public Hotel Settings Routes Tests', () => {
  let adminToken;
  let userToken;
  let adminUser;
  let regularUser;

  beforeAll(async () => {
    await connectDB();

    await User.deleteMany({});
    await HotelSettings.deleteMany({});

    // Setup initial default hotel settings
    await HotelSettings.create({
      _id: 'default',
      hotelName: 'Initial Hotel Name',
      cgstPercentage: 6,
      sgstPercentage: 6,
      advancePaymentPercent: 20,
      hotelPhone: '9999999999',
      hotelEmail: 'initial@hotel.com',
      hotelAddress: '123 Initial St',
      hotelTagline: 'Tagline Here',
      gstNumber: 'GST123456789',
    });

    adminUser = await User.create({
      name: 'Admin Test',
      email: 'admin@test.com',
      phone: '1234567890',
      password: 'password123',
      role: ROLES.ADMIN,
      isActive: true,
    });
    adminToken = generateAccessToken({ id: adminUser._id });

    regularUser = await User.create({
      name: 'User Test',
      email: 'user@test.com',
      phone: '0987654321',
      password: 'password123',
      role: ROLES.USER,
      isActive: true,
    });
    userToken = generateAccessToken({ id: regularUser._id });
  });

  afterAll(async () => {
    await User.deleteMany({});
    await HotelSettings.deleteMany({});
    await mongoose.disconnect();
  });

  describe('GET /api/admin/settings', () => {
    it('should return 401 if request is not authenticated', async () => {
      const res = await request(app).get('/api/admin/settings');
      expect(res.status).toBe(401);
    });

    it('should return 403 if request is authenticated as non-admin', async () => {
      const res = await request(app)
        .get('/api/admin/settings')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(403);
    });

    it('should fetch settings successfully as admin', async () => {
      const res = await request(app)
        .get('/api/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hotelName).toBe('Initial Hotel Name');
      expect(res.body.data.cgstPercentage).toBe(6);
    });
  });

  describe('PATCH /api/admin/settings', () => {
    it('should return 401 if request is not authenticated', async () => {
      const res = await request(app)
        .patch('/api/admin/settings')
        .send({ hotelName: 'Updated Hotel Name' });
      expect(res.status).toBe(401);
    });

    it('should return 403 if request is authenticated as non-admin', async () => {
      const res = await request(app)
        .patch('/api/admin/settings')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ hotelName: 'Updated Hotel Name' });
      expect(res.status).toBe(403);
    });

    it('should update settings successfully as admin', async () => {
      const res = await request(app)
        .patch('/api/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          hotelName: 'Updated Hotel Name',
          cgstPercentage: 9,
          sgstPercentage: 9,
          advancePaymentPercent: 25,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hotelName).toBe('Updated Hotel Name');
      expect(res.body.data.cgstPercentage).toBe(9);
      expect(res.body.data.sgstPercentage).toBe(9);
      expect(res.body.data.advancePaymentPercent).toBe(25);
    });
  });

  describe('GET /api/settings/public', () => {
    it('should fetch public settings without authorization', async () => {
      const res = await request(app).get('/api/settings/public');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.cgstPercentage).toBe(9);
      expect(res.body.data.sgstPercentage).toBe(9);
      expect(res.body.data.advancePaymentPercent).toBe(25);
      // Ensure private fields are NOT returned
      expect(res.body.data.hotelName).toBeUndefined();
      expect(res.body.data.hotelPhone).toBeUndefined();
    });
  });
});
