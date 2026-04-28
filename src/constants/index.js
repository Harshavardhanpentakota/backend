'use strict';

const ROLES = Object.freeze({
  ADMIN: 'admin',
  RECEPTIONIST: 'receptionist',
  USER: 'user',
});

const ROOM_TYPES = Object.freeze({
  DELUXE_NON_AC: 'Deluxe Non AC',
  DELUXE_AC: 'Deluxe AC',
  SUITE: 'Suite',
});

const ROOM_STATUS = Object.freeze({
  AVAILABLE: 'available',
  OCCUPIED: 'occupied',
  MAINTENANCE: 'maintenance',
  RESERVED: 'reserved',
});

const BOOKING_STATUS = Object.freeze({
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CHECKED_IN: 'checked_in',
  CHECKED_OUT: 'checked_out',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  NO_SHOW: 'no_show',
});

const BOOKING_SOURCE = Object.freeze({
  ONLINE: 'online',
  OFFLINE: 'offline',
  PHONE: 'phone',
});

const PAYMENT_METHOD = Object.freeze({
  RAZORPAY: 'razorpay',
  UPI: 'upi',
  CASH: 'cash',
  CARD: 'card',
  NET_BANKING: 'net_banking',
});

const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
});

const SERVICE_TYPE = Object.freeze({
  FOOD: 'food',
  CLEANING: 'cleaning',
  LAUNDRY: 'laundry',
  MAINTENANCE: 'maintenance',
  OTHER: 'other',
});

const SERVICE_STATUS = Object.freeze({
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

const ORDER_STATUS = Object.freeze({
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PREPARING: 'preparing',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
});

const STAFF_ROLES = Object.freeze({
  MANAGER: 'manager',
  RECEPTIONIST: 'receptionist',
  HOUSEKEEPING: 'housekeeping',
  CHEF: 'chef',
  SECURITY: 'security',
  MAINTENANCE: 'maintenance',
  WAITER: 'waiter',
});

const SHIFT = Object.freeze({
  MORNING: 'morning',
  AFTERNOON: 'afternoon',
  NIGHT: 'night',
});

// Cancellation policy
const CANCELLATION_POLICY = Object.freeze({
  FULL_REFUND_HOURS: 24,   // cancel > 24h before check-in → 80% refund
  REFUND_PERCENTAGE: 80,    // % refunded when cancelled in time
  NO_REFUND_PERCENTAGE: 0,  // % refunded when cancelled < 24h
});

// Hotel info
const HOTEL = Object.freeze({
  NAME: process.env.HOTEL_NAME || 'Hotel Abhitej Inn',
  ADDRESS: process.env.HOTEL_ADDRESS || 'Near Jeypore Junction, Araku Village Mandal, Dumbriguda, Andhra Pradesh',
  PHONE: process.env.HOTEL_PHONE || '+91-8801234567',
  EMAIL: process.env.HOTEL_EMAIL || 'info@hotelabhitejinn.com',
  CHECKIN_TIME: process.env.HOTEL_CHECKIN_TIME || '12:00',
  CHECKOUT_TIME: process.env.HOTEL_CHECKOUT_TIME || '10:00',
  FLOORS: 3,
  TOTAL_ROOMS: 20,
  GST_PERCENTAGE: 12,
});

// Pagination defaults
const PAGINATION = Object.freeze({
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
});

module.exports = {
  ROLES,
  ROOM_TYPES,
  ROOM_STATUS,
  BOOKING_STATUS,
  BOOKING_SOURCE,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  SERVICE_TYPE,
  SERVICE_STATUS,
  ORDER_STATUS,
  STAFF_ROLES,
  SHIFT,
  CANCELLATION_POLICY,
  HOTEL,
  PAGINATION,
};
