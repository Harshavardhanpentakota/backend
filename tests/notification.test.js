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
const Notification = require('../src/models/Notification');
const ActivityLog = require('../src/models/ActivityLog');
const { generateAccessToken } = require('../src/utils/jwt');
const { ROLES } = require('../src/constants');
const { createNotification } = require('../src/utils/notification');
const { logActivity } = require('../src/utils/activity');

describe('Notification and Activity Log Audit Trail System Tests', () => {
  let adminToken;
  let receptionistToken;
  let userToken;
  let adminUser;
  let receptionistUser;
  let regularUser;

  beforeAll(async () => {
    await connectDB();

    // Clean up collections
    await User.deleteMany({});
    await Notification.deleteMany({});
    await ActivityLog.deleteMany({});

    // Create test accounts
    adminUser = await User.create({
      name: 'Admin Auditor',
      email: 'admin@audit.com',
      phone: '1111111111',
      password: 'password123',
      role: ROLES.ADMIN,
      isActive: true,
    });
    adminToken = generateAccessToken({ id: adminUser._id });

    receptionistUser = await User.create({
      name: 'Receptionist Auditor',
      email: 'receptionist@audit.com',
      phone: '2222222222',
      password: 'password123',
      role: ROLES.RECEPTIONIST,
      isActive: true,
    });
    receptionistToken = generateAccessToken({ id: receptionistUser._id });

    regularUser = await User.create({
      name: 'Regular Auditor',
      email: 'user@audit.com',
      phone: '3333333333',
      password: 'password123',
      role: ROLES.USER,
      isActive: true,
    });
    userToken = generateAccessToken({ id: regularUser._id });
  });

  afterAll(async () => {
    await User.deleteMany({});
    await Notification.deleteMany({});
    await ActivityLog.deleteMany({});
    await mongoose.disconnect();
  });

  describe('Notification Engine & API Tests', () => {
    beforeEach(async () => {
      await Notification.deleteMany({});
    });

    it('should create database notification entries successfully', async () => {
      const notif = await createNotification({
        recipientId: regularUser._id,
        title: 'Booking Confirmed',
        message: 'Your stay has been confirmed.',
        type: 'booking_confirmed',
        metadata: { bookingId: '123' }
      });

      expect(notif).toBeDefined();
      expect(notif.title).toBe('Booking Confirmed');
      expect(notif.isRead).toBe(false);

      const dbNotif = await Notification.findById(notif._id);
      expect(dbNotif).toBeDefined();
      expect(dbNotif.message).toBe('Your stay has been confirmed.');
    });

    it('should query unread counts for recipient', async () => {
      await createNotification({
        recipientId: regularUser._id,
        title: 'Unread 1',
        message: 'Msg 1',
        type: 'booking_created'
      });

      await createNotification({
        recipientId: regularUser._id,
        title: 'Unread 2',
        message: 'Msg 2',
        type: 'booking_created'
      });

      // Different recipient should not match
      await createNotification({
        recipientId: adminUser._id,
        title: 'Admin Msg',
        message: 'Msg 3',
        type: 'booking_created'
      });

      const res = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(2);
    });

    it('should mark single notification as read', async () => {
      const notif = await createNotification({
        recipientId: regularUser._id,
        title: 'Mark Read Test',
        message: 'Please read me',
        type: 'booking_created'
      });

      const res = await request(app)
        .patch(`/api/notifications/${notif._id}/read`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.notification.isRead).toBe(true);

      const updated = await Notification.findById(notif._id);
      expect(updated.isRead).toBe(true);
    });

    it('should mark all notifications as read', async () => {
      await createNotification({ recipientId: regularUser._id, title: 'T1', message: 'M1', type: 't' });
      await createNotification({ recipientId: regularUser._id, title: 'T2', message: 'M2', type: 't' });

      const res = await request(app)
        .patch('/api/notifications/read-all')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const count = await Notification.countDocuments({ recipientId: regularUser._id, isRead: false });
      expect(count).toBe(0);
    });

    it('should isolate notifications role-wise', async () => {
      // Create admin only, receptionist only, and user only notifications
      await createNotification({ recipientRole: ROLES.ADMIN, title: 'Admin Alert', message: 'Secret admin data', type: 'alert' });
      await createNotification({ recipientRole: ROLES.RECEPTIONIST, title: 'Reception Alert', message: 'Reception stuff', type: 'alert' });
      await createNotification({ recipientId: regularUser._id, title: 'User Alert', message: 'User details', type: 'alert' });

      // Regular user query
      const userRes = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${userToken}`);
      expect(userRes.status).toBe(200);
      expect(userRes.body.notifications.length).toBe(1);
      expect(userRes.body.notifications[0].title).toBe('User Alert');

      // Admin query
      const adminRes = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.notifications.some(n => n.title === 'Admin Alert')).toBe(true);
      expect(adminRes.body.notifications.some(n => n.title === 'Reception Alert')).toBe(false);
    });
  });

  describe('Activity History Audit Trail Tests', () => {
    beforeEach(async () => {
      await ActivityLog.deleteMany({});
    });

    it('should create activity logs correctly', async () => {
      const log = await logActivity({
        userId: adminUser._id,
        userName: adminUser.name,
        role: adminUser.role,
        action: 'Room Created',
        module: 'Rooms',
        description: 'Room 505 created successfully',
        newData: { roomNumber: '505', type: 'Suite' }
      });

      expect(log).toBeDefined();
      expect(log.action).toBe('Room Created');
      expect(log.module).toBe('Rooms');
      expect(log.userName).toBe(adminUser.name);

      const dbLog = await ActivityLog.findById(log._id);
      expect(dbLog).toBeDefined();
      expect(dbLog.description).toBe('Room 505 created successfully');
    });

    it('should restrict Activity History API to Admin role only', async () => {
      // User request should return 403 Forbidden
      const userRes = await request(app)
        .get('/api/admin/activity-logs')
        .set('Authorization', `Bearer ${userToken}`);
      expect(userRes.status).toBe(403);

      // Receptionist request should return 403 Forbidden (unless granted, defaults to denied)
      const receptionistRes = await request(app)
        .get('/api/admin/activity-logs')
        .set('Authorization', `Bearer ${receptionistToken}`);
      expect(receptionistRes.status).toBe(403);

      // Admin request should succeed
      const adminRes = await request(app)
        .get('/api/admin/activity-logs')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.success).toBe(true);
    });

    it('should support search and filters (module, user, action)', async () => {
      await logActivity({
        userId: adminUser._id,
        userName: adminUser.name,
        role: adminUser.role,
        action: 'Room Created',
        module: 'Rooms',
        description: 'Room 601 created'
      });

      await logActivity({
        userId: adminUser._id,
        userName: adminUser.name,
        role: adminUser.role,
        action: 'Room Status Changed',
        module: 'Rooms',
        description: 'Room 601 status updated to occupied'
      });

      await logActivity({
        userId: adminUser._id,
        userName: adminUser.name,
        role: adminUser.role,
        action: 'Staff Created',
        module: 'Staff',
        description: 'Staff member added'
      });

      // Filter by module Rooms
      let res = await request(app)
        .get('/api/admin/activity-logs?module=Rooms')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBe(2);

      // Filter by Staff
      res = await request(app)
        .get('/api/admin/activity-logs?module=Staff')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBe(1);

      // Search query "member"
      res = await request(app)
        .get('/api/admin/activity-logs?search=member')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBe(1);
      expect(res.body.logs[0].action).toBe('Staff Created');
    });

    it('should support exporting to CSV format', async () => {
      await logActivity({
        userId: adminUser._id,
        userName: adminUser.name,
        role: adminUser.role,
        action: 'Room Created',
        module: 'Rooms',
        description: 'Room 602 created'
      });

      const res = await request(app)
        .get('/api/admin/activity-logs/export?format=csv')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('Room 602 created');
      expect(res.text).toContain('"Rooms","Room Created"');
    });
  });
});
