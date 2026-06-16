'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Staff = require('../src/models/Staff');
const Booking = require('../src/models/Booking');
const Invoice = require('../src/models/Invoice');
const Payment = require('../src/models/Payment');
const RestaurantOrder = require('../src/models/RestaurantOrder');
const ServiceRequest = require('../src/models/ServiceRequest');
const HotelSettings = require('../src/models/HotelSettings');
const connectDB = require('../src/config/db');
const { ROOM_TYPES, ROLES, STAFF_ROLES, SHIFT } = require('../src/constants');

// Seed Room Data
const rooms = [
  // Floor 1 — Deluxe Non AC (Rooms 101–108)
  ...Array.from({ length: 8 }, (_, i) => ({
    roomNumber: `10${i + 1}`,
    floor: 1,
    type: ROOM_TYPES.DELUXE_NON_AC,
    price: 1800,
    capacity: 2,
    size: '22 sqm',
    beds: '1 Queen Bed',
    amenities: ['WiFi', 'TV', 'Hot Water', 'Fan'],
    description:
      'Comfortable Deluxe Non-AC room with queen-size bed, flat-screen TV, free WiFi, and hot water. Ideal for budget-conscious travellers.',
    status: 'available',
  })),

  // Floor 2 — Deluxe AC (Rooms 201–210)
  ...Array.from({ length: 10 }, (_, i) => ({
    roomNumber: `20${i + 1}`,
    floor: 2,
    type: ROOM_TYPES.DELUXE_AC,
    price: 2800,
    capacity: 2,
    size: '28 sqm',
    beds: '1 King Bed',
    amenities: ['WiFi', 'AC', 'TV', 'Hot Water', 'Mini Fridge'],
    description:
      'Spacious Deluxe AC room with king-size bed, air conditioning, flat-screen TV, mini fridge, and free WiFi. Perfect for couples and business travellers.',
    status: 'available',
  })),

  // Floor 3 — Suites (Rooms 301–302)
  ...Array.from({ length: 2 }, (_, i) => ({
    roomNumber: `30${i + 1}`,
    floor: 3,
    type: ROOM_TYPES.SUITE,
    price: 5400,
    capacity: 3,
    size: '55 sqm',
    beds: '1 King Bed + Sofa',
    amenities: ['WiFi', 'AC', 'Smart TV', 'Hot Water', 'Mini Bar', 'Jacuzzi', 'Workspace'],
    description:
      'Premium Suite featuring a separate living area, king-size bed, Jacuzzi, mini bar, workspace, and panoramic views of Araku Valley. Ideal for a luxurious stay.',
    status: 'available',
  })),
];

// Seed User Data
const users = [
  {
    name: 'Abhitej Admin',
    email: 'admin@hotelabhitejinn.com',
    password: 'Admin@1234',
    phone: '+91-9876543210',
    role: ROLES.ADMIN,
  },
  {
    name: 'Ravi Receptionist',
    email: 'reception@hotelabhitejinn.com',
    password: 'Recept@1234',
    phone: '+91-9876543211',
    role: ROLES.RECEPTIONIST,
  },
  {
    name: 'Aarav Patel',
    email: 'aarav.patel@example.com',
    password: 'Guest@1234',
    phone: '+91-9876543212',
    role: ROLES.USER,
    memberSince: 2024,
    loyaltyTier: 'Gold',
    totalStays: 3,
  },
  {
    name: 'Ananya Sharma',
    email: 'ananya.sharma@example.com',
    password: 'Guest@1234',
    phone: '+91-9876543213',
    role: ROLES.USER,
    memberSince: 2025,
    loyaltyTier: 'Bronze',
    totalStays: 1,
  },
];

// Seed Staff Data
const staff = [
  {
    employeeId: 'EMP-0001',
    name: 'Suresh Kumar',
    role: STAFF_ROLES.MANAGER,
    shift: SHIFT.MORNING,
    contact: { phone: '+91-9000000001', email: 'suresh@hotelabhitejinn.com' },
    salary: 35000,
  },
  {
    employeeId: 'EMP-0002',
    name: 'Lakshmi Devi',
    role: STAFF_ROLES.HOUSEKEEPING,
    shift: SHIFT.MORNING,
    contact: { phone: '+91-9000000002' },
    salary: 15000,
  },
  {
    employeeId: 'EMP-0003',
    name: 'Venkat Rao',
    role: STAFF_ROLES.CHEF,
    shift: SHIFT.AFTERNOON,
    contact: { phone: '+91-9000000003' },
    salary: 22000,
  },
];

const resetDatabase = async () => {
  console.log('🔄 Connecting to database for reset...');
  await connectDB();

  try {
    // 1. Delete all transactional data
    console.log('🗑  De-coupling and deleting bookings, invoices, payments, and orders...');
    await Promise.all([
      Booking.deleteMany({}),
      Invoice.deleteMany({}),
      Payment.deleteMany({}),
      RestaurantOrder.deleteMany({}),
      ServiceRequest.deleteMany({}),
      User.deleteMany({}),
      Room.deleteMany({}),
      Staff.deleteMany({}),
      HotelSettings.deleteMany({}),
    ]);
    console.log('✅ Deleted all transactional and master collections.');

    // 2. Seed default users
    const createdUsers = await User.create(users);
    console.log(`✅ Seeded ${createdUsers.length} users successfully.`);

    // 3. Seed default rooms
    const createdRooms = await Room.insertMany(rooms);
    console.log(`✅ Seeded ${createdRooms.length} rooms successfully.`);

    // 4. Seed staff
    const createdStaff = await Staff.create(staff);
    console.log(`✅ Seeded ${createdStaff.length} staff successfully.`);

    // 5. Seed default HotelSettings
    await HotelSettings.create({
      _id: 'default',
      cgstPercentage: 6,
      sgstPercentage: 6,
      advancePaymentPercent: 10,
      hotelName: 'Hotel Abhitej Inn',
      hotelPhone: '+91 88012 34567',
      hotelEmail: 'abhitejinn11@gmail.com',
      hotelAddress: 'Near Jeypore Junction, Araku Village Mandal, Dumbriguda, Andhra Pradesh',
    });
    console.log('✅ Initialized default Hotel Settings.');

    console.log('\n🏨 Database successfully reset and re-seeded!');
    console.log('\n🔑 Credentials:');
    console.log('   Admin:        admin@hotelabhitejinn.com     / Admin@1234');
    console.log('   Receptionist: reception@hotelabhitejinn.com / Recept@1234');
    console.log('   Guest 1:      aarav.patel@example.com       / Guest@1234');
    console.log('   Guest 2:      ananya.sharma@example.com     / Guest@1234');

  } catch (error) {
    console.error('❌ Reset script failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
};

resetDatabase();
