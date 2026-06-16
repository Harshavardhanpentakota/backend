'use strict';

// Load dotenv before setting environment/db overrides
require('dotenv').config();

// 1. Force environment and switch database to -test
process.env.NODE_ENV = 'test';
if (process.env.MONGODB_URI) {
  process.env.MONGODB_URI = process.env.MONGODB_URI.replace('/hotel-management', '/hotel-management-test');
}

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const connectDB = require('../src/config/db');
const Room = require('../src/models/Room');
const Booking = require('../src/models/Booking');
const User = require('../src/models/User');
const HotelSettings = require('../src/models/HotelSettings');
const Invoice = require('../src/models/Invoice');
const { generateAccessToken } = require('../src/utils/jwt');
const { ROOM_STATUS, BOOKING_STATUS, ROLES } = require('../src/constants');

describe('Inventory-Based Availability & Pricing Override Engine Tests', () => {
  let adminToken;
  let userToken;
  let adminUser;
  let regularUser;
  let suiteRoom1;
  let suiteRoom2;

  beforeAll(async () => {
    // Connect to test database
    await connectDB();

    // Clear collections
    await User.deleteMany({});
    await Room.deleteMany({});
    await Booking.deleteMany({});
    await HotelSettings.deleteMany({});
    await Invoice.deleteMany({});

    // Create test HotelSettings
    await HotelSettings.create({
      _id: 'default',
      hotelName: 'Test Hotel',
      cgstPercentage: 6,
      sgstPercentage: 6,
      advancePaymentPercent: 10,
    });

    // Create Admin User
    adminUser = await User.create({
      name: 'Admin Test',
      email: 'admin@test.com',
      phone: '1234567890',
      password: 'password123',
      role: ROLES.ADMIN,
      isActive: true,
    });
    adminToken = generateAccessToken({ id: adminUser._id });

    // Create Regular User
    regularUser = await User.create({
      name: 'User Test',
      email: 'user@test.com',
      phone: '0987654321',
      password: 'password123',
      role: ROLES.USER,
      isActive: true,
    });
    userToken = generateAccessToken({ id: regularUser._id });

    // Create 2 Suites
    suiteRoom1 = await Room.create({
      roomNumber: '401',
      floor: 3,
      type: 'Suite',
      price: 4000,
      capacity: 4,
      size: '500 sq ft',
      beds: '1 King Bed',
      status: ROOM_STATUS.AVAILABLE,
      isActive: true,
    });

    suiteRoom2 = await Room.create({
      roomNumber: '402',
      floor: 3,
      type: 'Suite',
      price: 4000,
      capacity: 4,
      size: '500 sq ft',
      beds: '1 King Bed',
      status: ROOM_STATUS.AVAILABLE,
      isActive: true,
    });
  });

  afterAll(async () => {
    // Clean up collections
    await User.deleteMany({});
    await Room.deleteMany({});
    await Booking.deleteMany({});
    await HotelSettings.deleteMany({});
    await Invoice.deleteMany({});

    // Disconnect mongoose
    await mongoose.disconnect();
  });

  describe('GET /api/rooms/:roomType/availability', () => {
    it('should return default inventory of 2 when no bookings exist', async () => {
      const res = await request(app)
        .get('/api/rooms/Suite/availability')
        .query({ checkIn: '2026-07-10', checkOut: '2026-07-15' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.inventory).toBe(2);
      expect(res.body.data.available).toBe(2);
      expect(res.body.data.fullyBookedDates).toHaveLength(0);
      expect(res.body.data.limitedAvailabilityDates).toHaveLength(0);
    });
  });

  describe('Booking creation & Overbooking Prevention', () => {
    it('should create booking when availability exists', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          roomType: 'Suite',
          checkInDate: '2026-07-10',
          checkOutDate: '2026-07-12',
          guests: 2,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(BOOKING_STATUS.PENDING);

      // Update booking to CONFIRMED to simulate advance paid (blocking inventory)
      await Booking.findByIdAndUpdate(res.body.data._id, { status: BOOKING_STATUS.CONFIRMED });
    });

    it('should show available inventory reduced to 1', async () => {
      const res = await request(app)
        .get('/api/rooms/Suite/availability')
        .query({ checkIn: '2026-07-09', checkOut: '2026-07-13' });

      expect(res.status).toBe(200);
      expect(res.body.data.available).toBe(1);
      expect(res.body.data.limitedAvailabilityDates).toContain('2026-07-10');
      expect(res.body.data.limitedAvailabilityDates).toContain('2026-07-11');
      expect(res.body.data.fullyBookedDates).toHaveLength(0);
    });

    it('should allow second booking during overlapping dates', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          roomType: 'Suite',
          checkInDate: '2026-07-10',
          checkOutDate: '2026-07-11',
          guests: 2,
        });

      expect(res.status).toBe(201);

      // Confirm the second booking
      await Booking.findByIdAndUpdate(res.body.data._id, { status: BOOKING_STATUS.CONFIRMED });
    });

    it('should show fully booked on July 10 (available = 0)', async () => {
      const res = await request(app)
        .get('/api/rooms/Suite/availability')
        .query({ checkIn: '2026-07-10', checkOut: '2026-07-11' });

      expect(res.status).toBe(200);
      expect(res.body.data.available).toBe(0);
      expect(res.body.data.fullyBookedDates).toContain('2026-07-10');
    });

    it('should prevent creating a third booking on fully booked dates', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          roomType: 'Suite',
          checkInDate: '2026-07-10',
          checkOutDate: '2026-07-11',
          guests: 2,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Selected room type is no longer available');
    });
  });

  describe('Check-In System, Assignable Rooms, and Pricing Overrides', () => {
    let bookingId;
    let bookingDocId;

    beforeAll(async () => {
      // Clear bookings for pricing and check-in test stability
      await Booking.deleteMany({});

      // Create room pricing override on suiteRoom1
      suiteRoom1.customPrice = 3500;
      await suiteRoom1.save();

      // Create a pending/confirmed booking
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          roomType: 'Suite',
          checkInDate: '2026-07-20',
          checkOutDate: '2026-07-22', // 2 nights
          guests: 2,
        });

      bookingId = res.body.data.bookingId;
      bookingDocId = res.body.data._id;

      // Confirm the booking
      await Booking.findByIdAndUpdate(bookingDocId, { status: BOOKING_STATUS.CONFIRMED });
    });

    it('should get assignable rooms for check-in excluding occupied/allocated rooms', async () => {
      const res = await request(app)
        .get(`/api/reception/bookings/${bookingDocId}/assignable-rooms`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2); // suiteRoom1 (override price) and suiteRoom2 (default price)

      const suite1Obj = res.body.data.find(r => r.roomNumber === '401');
      expect(suite1Obj.customPrice).toBe(3500);
    });

    it('should check in guest and apply the customPrice override', async () => {
      const res = await request(app)
        .post('/api/reception/checkin')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          bookingId,
          roomId: suiteRoom1._id.toString(),
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify booking pricing is updated with the custom override price
      const updatedBooking = await Booking.findById(bookingDocId);
      expect(updatedBooking.pricePerNight).toBe(3500);
      expect(updatedBooking.subtotal).toBe(7000); // 3500 * 2 nights
      expect(updatedBooking.tax).toBe(840); // 7000 * 12% GST (6% CGST + 6% SGST)
      expect(updatedBooking.totalAmount).toBe(7840);
      expect(updatedBooking.status).toBe(BOOKING_STATUS.CHECKED_IN);

      // Verify room status is set to occupied
      const updatedRoom = await Room.findById(suiteRoom1._id);
      expect(updatedRoom.status).toBe(ROOM_STATUS.OCCUPIED);
    });

    it('should check out guest, reset room status, and generate invoice using overridden pricing', async () => {
      const res = await request(app)
        .post('/api/reception/checkout')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          bookingId,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify room status is reset to available
      const updatedRoom = await Room.findById(suiteRoom1._id);
      expect(updatedRoom.status).toBe(ROOM_STATUS.AVAILABLE);

      // Verify invoice exists and has correct pricing
      const invoice = await Invoice.findOne({ booking: bookingDocId });
      expect(invoice).toBeDefined();
      expect(invoice.roomSubtotal).toBe(7000);
      expect(invoice.tax).toBe(840);
      expect(invoice.totalAmount).toBe(7840);
    });
  });

  describe('Pricing Override Management CRUD', () => {
    it('should allow admin to update/set customPrice override', async () => {
      const res = await request(app)
        .patch(`/api/admin/rooms/${suiteRoom2._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customPrice: 3800,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.customPrice).toBe(3800);

      const dbRoom = await Room.findById(suiteRoom2._id);
      expect(dbRoom.customPrice).toBe(3800);
    });

    it('should allow admin to reset customPrice override to default (unset)', async () => {
      const res = await request(app)
        .patch(`/api/admin/rooms/${suiteRoom2._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customPrice: null,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.customPrice).toBeUndefined();

      const dbRoom = await Room.findById(suiteRoom2._id);
    });
  });

  describe('Batch Pricing Update API', () => {
    it('should allow admin to update prices for all rooms of a type in one call', async () => {
      const res = await request(app)
        .patch('/api/admin/rooms/pricing')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          pricing: {
            'Suite': 5800,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify both suiteRoom1 and suiteRoom2 have their base price updated to 5800
      const r1 = await Room.findById(suiteRoom1._id);
      const r2 = await Room.findById(suiteRoom2._id);
      expect(r1.price).toBe(5800);
      expect(r2.price).toBe(5800);
    });
  });

  describe('Soft Deletion Logic Tests', () => {
    it('should soft-delete booking and hide it from query lists but preserve in db', async () => {
      // 1. Create a booking
      const booking = await Booking.create({
        bookingId: 'BK-SOFTDELETE-TEST',
        user: regularUser._id,
        room: suiteRoom1._id,
        roomType: 'Suite',
        pricePerNight: 4000,
        checkInDate: new Date('2026-08-01'),
        checkOutDate: new Date('2026-08-03'),
        guests: 2,
        nights: 2,
        subtotal: 8000,
        totalAmount: 8000,
      });

      // Verify booking is found via standard find
      const foundBefore = await Booking.findById(booking._id);
      expect(foundBefore).toBeDefined();
      expect(foundBefore.bookingId).toBe('BK-SOFTDELETE-TEST');

      // 2. Perform deletion request via API
      const deleteRes = await request(app)
        .delete(`/api/admin/bookings/${booking._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteRes.status).toBe(200);

      // 3. Verify that standard query doesn't find it anymore
      const foundAfter = await Booking.findById(booking._id);
      expect(foundAfter).toBeNull();

      // 4. Verify that direct query bypassing Mongoose middleware still finds it with isDeleted true
      const rawDoc = await mongoose.connection.db.collection('bookings').findOne({ _id: booking._id });
      expect(rawDoc).toBeDefined();
      expect(rawDoc.isDeleted).toBe(true);
    });
  });
});
