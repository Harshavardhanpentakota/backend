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
const Room = require('../src/models/Room');
const Booking = require('../src/models/Booking');
const User = require('../src/models/User');
const HotelSettings = require('../src/models/HotelSettings');
const Invoice = require('../src/models/Invoice');
const Payment = require('../src/models/Payment');
const { generateAccessToken } = require('../src/utils/jwt');
const { ROOM_STATUS, BOOKING_STATUS, ROLES } = require('../src/constants');

describe('Room Change, Stay Extension, and Settings Tax Tests', () => {
  let adminToken;
  let userToken;
  let adminUser;
  let regularUser;
  let roomA;
  let roomB;

  beforeAll(async () => {
    await connectDB();

    await User.deleteMany({});
    await Room.deleteMany({});
    await Booking.deleteMany({});
    await HotelSettings.deleteMany({});
    await Invoice.deleteMany({});
    await Payment.deleteMany({});

    // Setup hotel settings with custom tax values (9% CGST, 9% SGST = 18% total tax)
    await HotelSettings.create({
      _id: 'default',
      hotelName: 'Test Hotel',
      cgstPercentage: 9,
      sgstPercentage: 9,
      advancePaymentPercent: 15,
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

    roomA = await Room.create({
      roomNumber: '101',
      floor: 1,
      type: 'Deluxe Non AC',
      price: 1000,
      capacity: 2,
      status: ROOM_STATUS.AVAILABLE,
      isActive: true,
    });

    roomB = await Room.create({
      roomNumber: '102',
      floor: 1,
      type: 'Suite',
      price: 2000,
      capacity: 2,
      status: ROOM_STATUS.AVAILABLE,
      isActive: true,
    });
  });

  afterAll(async () => {
    await User.deleteMany({});
    await Room.deleteMany({});
    await Booking.deleteMany({});
    await HotelSettings.deleteMany({});
    await Invoice.deleteMany({});
    await Payment.deleteMany({});
    await mongoose.disconnect();
  });

  describe('Online Booking Creation with Dynamic Tax Settings', () => {
    it('should calculate tax at 18% matching the custom cgst (9%) and sgst (9%)', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          roomType: 'Deluxe Non AC',
          checkInDate: '2026-08-10',
          checkOutDate: '2026-08-15', // 5 nights
          guests: 2,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const booking = res.body.data;
      expect(booking.subtotal).toBe(5000); // 1000 * 5 nights
      expect(booking.tax).toBe(900); // 5000 * 18% = 900
      expect(booking.totalAmount).toBe(5900);
    });
  });

  describe('Room Change Stay Cost Calculation & Extension with Room History', () => {
    let bookingId;
    let bookingDocId;

    beforeAll(async () => {
      // Clear bookings
      await Booking.deleteMany({});

      const checkIn = new Date();
      checkIn.setHours(12, 0, 0, 0);
      checkIn.setDate(checkIn.getDate() - 2);
      const checkOut = new Date();
      checkOut.setHours(12, 0, 0, 0);
      checkOut.setDate(checkOut.getDate() + 3);

      // Create an offline booking to bypass online payment check
      const res = await request(app)
        .post('/api/reception/book')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          roomId: roomA._id.toString(),
          checkInDate: checkIn.toISOString(),
          checkOutDate: checkOut.toISOString(), // 5 nights
          guests: 2,
          guestDetails: {
            name: 'History Test Guest',
            phone: '8888888888',
          },
          source: 'offline',
        });

      bookingId = res.body.data.bookingId;
      bookingDocId = res.body.data._id;
    });

    it('should check in successfully', async () => {
      const res = await request(app)
        .post('/api/reception/checkin')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          bookingId,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should move guest to roomB and record roomA in roomHistory', async () => {
      // 1. Manually backdate actualCheckIn to simulate 2 nights spent in roomA
      const checkInDate = new Date();
      checkInDate.setHours(12, 0, 0, 0);
      checkInDate.setDate(checkInDate.getDate() - 2);
      await Booking.findByIdAndUpdate(bookingDocId, { actualCheckIn: checkInDate });

      // 2. Perform room change to roomB (Deluxe, price = 2000)
      const res = await request(app)
        .patch(`/api/admin/bookings/${bookingDocId}/change-room`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newRoomId: roomB._id.toString(),
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updated = res.body.data;
      expect(updated.roomHistory).toHaveLength(1);
      expect(updated.roomHistory[0].roomNumber).toBe('101');
      expect(updated.roomHistory[0].nights).toBe(2);
      expect(updated.roomHistory[0].pricePerNight).toBe(1000);

      // Total nights = 5. Room A nights = 2. Room B nights = 3.
      // Subtotal = 2 * 1000 + 3 * 2000 = 8000.
      expect(updated.subtotal).toBe(8000);
      expect(updated.tax).toBe(1440); // 8000 * 18% = 1440
      expect(updated.totalAmount).toBe(9440);
    });

    it('should extend stay to 7 nights and calculate subtotal correctly', async () => {
      const newCheckoutDate = new Date();
      newCheckoutDate.setHours(12, 0, 0, 0);
      newCheckoutDate.setDate(newCheckoutDate.getDate() + 5); // 2 past nights + 5 remaining Deluxe nights = 7 nights total

      const res = await request(app)
        .patch(`/api/reception/bookings/${bookingId}/extend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newCheckOutDate: newCheckoutDate.toISOString(),
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updated = res.body.data;
      expect(updated.nights).toBe(7);
      // Room A nights = 2. Room B nights = 5.
      // Subtotal = 2 * 1000 + 5 * 2000 = 12000.
      expect(updated.subtotal).toBe(12000);
      expect(updated.tax).toBe(2160); // 12000 * 18% = 2160
      expect(updated.totalAmount).toBe(14160);
    });

    it('should checkout guest successfully and match the invoice calculations', async () => {
      const res = await request(app)
        .post('/api/reception/checkout')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          bookingId,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const invoice = res.body.data.invoice;
      expect(invoice.roomSubtotal).toBe(12000);
      expect(invoice.tax).toBe(2160);
      expect(invoice.totalAmount).toBe(14160);
    });
  });
});
