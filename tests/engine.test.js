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
const Payment = require('../src/models/Payment');
const Staff = require('../src/models/Staff');
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

      // Verify check-in advance payment record is created
      const advPayment = await Payment.findOne({ booking: bookingDocId, notes: /Advance payment/ });
      expect(advPayment).toBeDefined();
      expect(advPayment.amount).toBe(700); // 10% of 7000 subtotal
      expect(advPayment.method).toBe('cash');
      expect(advPayment.status).toBe('paid');
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

      // Verify check-out balance payment record is created
      const balPayment = await Payment.findOne({ booking: bookingDocId, notes: /Balance payment/ });
      expect(balPayment).toBeDefined();
      expect(balPayment.amount).toBe(7140); // 7840 total - 700 advance
      expect(balPayment.method).toBe('cash');
      expect(balPayment.status).toBe('paid');
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

    it('should soft-delete staff member and hide them from query lists but preserve in db', async () => {
      // 1. Create a staff member
      const staffMember = await Staff.create({
        name: 'Staff Soft Delete Test',
        role: 'receptionist',
        shift: 'morning',
      });

      // Verify staff is found via standard find
      const foundBefore = await Staff.findById(staffMember._id);
      expect(foundBefore).toBeDefined();
      expect(foundBefore.name).toBe('Staff Soft Delete Test');

      // 2. Perform deletion request via API
      const deleteRes = await request(app)
        .delete(`/api/admin/staff/${staffMember._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteRes.status).toBe(200);

      // 3. Verify that standard query doesn't find them anymore
      const foundAfter = await Staff.findById(staffMember._id);
      expect(foundAfter).toBeNull();

      // 4. Verify that direct query bypassing Mongoose middleware still finds them with isDeleted true
      const rawDoc = await mongoose.connection.db.collection('staffs').findOne({ _id: staffMember._id });
      expect(rawDoc).toBeDefined();
      expect(rawDoc.isDeleted).toBe(true);
    });

    it('should prevent soft-deleting invoice when guest is currently checked_in', async () => {
      // 1. Create a booking in checked_in status
      const booking = await Booking.create({
        bookingId: 'BK-INVDELETE-TEST',
        user: regularUser._id,
        room: suiteRoom1._id,
        roomType: 'Suite',
        pricePerNight: 4000,
        checkInDate: new Date(),
        checkOutDate: new Date(Date.now() + 2 * 24 * 3600 * 1000),
        guests: 2,
        nights: 2,
        subtotal: 8000,
        totalAmount: 8000,
        status: 'checked_in',
      });

      // 2. Create an invoice for that booking
      const invoice = await Invoice.create({
        invoiceNumber: 'INV-DELETE-TEST',
        booking: booking._id,
        user: regularUser._id,
        room: suiteRoom1._id,
        roomSubtotal: 8000,
        subtotal: 8000,
        cgstPercentage: 6,
        sgstPercentage: 6,
        cgst: 480,
        sgst: 480,
        tax: 960,
        totalAmount: 8960,
        advancePaid: 800,
        balanceDue: 8160,
      });

      // 3. Attempt to delete the invoice via API
      const res = await request(app)
        .delete(`/api/admin/invoices/${invoice._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Should decline with 400 and state the reason
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Guest is in stay, cannot delete the invoice');

      // Verify invoice was NOT soft-deleted in database
      const dbInvoice = await Invoice.findById(invoice._id);
      expect(dbInvoice).toBeDefined();
      expect(dbInvoice.isDeleted).toBe(false);

      // 4. Change booking status to checked_out and check deletion succeeds
      await Booking.findByIdAndUpdate(booking._id, { status: 'checked_out' });
      const deleteRes = await request(app)
        .delete(`/api/admin/invoices/${invoice._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      const deletedInvoice = await Invoice.findById(invoice._id);
      expect(deletedInvoice).toBeNull(); // soft-deleted and filtered out
    });
  });

  describe('Password-Verified Refund Logic Tests', () => {
    it('should fail refund with incorrect password and succeed with correct password', async () => {
      // 1. Create a booking and a payment
      const booking = await Booking.create({
        bookingId: 'BK-REFUND-TEST',
        user: regularUser._id,
        roomType: 'Suite',
        pricePerNight: 4000,
        checkInDate: new Date('2026-09-01'),
        checkOutDate: new Date('2026-09-03'),
        guests: 2,
        nights: 2,
        subtotal: 8000,
        totalAmount: 8000,
        status: BOOKING_STATUS.CONFIRMED,
      });

      const payment = await Payment.create({
        booking: booking._id,
        user: regularUser._id,
        amount: 8000,
        method: 'cash',
        status: 'paid',
        transactionId: 'TXN-REFUND-TEST',
      });

      // 2. Attempt refund with WRONG password
      const badRes = await request(app)
        .post(`/api/payments/${payment._id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          password: 'wrong_password_123',
          reason: 'Customer requested refund',
        });

      expect(badRes.status).toBe(401);
      expect(badRes.body.success).toBe(false);
      expect(badRes.body.message).toContain('Invalid password');

      // 3. Attempt refund with CORRECT password
      const goodRes = await request(app)
        .post(`/api/payments/${payment._id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          password: 'password123',
          reason: 'Customer requested refund',
        });

      expect(goodRes.status).toBe(200);
      expect(goodRes.body.success).toBe(true);

      // Verify payment and booking statuses in db
      const updatedPayment = await Payment.findById(payment._id);
      expect(updatedPayment.status).toBe('refunded');

      const updatedBooking = await Booking.findById(booking._id);
      expect(updatedBooking.paymentStatus).toBe('refunded');
    });
  });
});
