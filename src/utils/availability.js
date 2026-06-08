'use strict';

const Room = require('../models/Room');
const Booking = require('../models/Booking');

// Simple lock mechanism to prevent race conditions on room type bookings
const locks = {};
const acquireLock = (roomType) => {
  if (!locks[roomType]) {
    locks[roomType] = Promise.resolve();
  }
  let resolveFn;
  const newPromise = new Promise((resolve) => {
    resolveFn = resolve;
  });
  const currentLock = locks[roomType];
  locks[roomType] = currentLock.then(() => newPromise);
  return () => {
    resolveFn();
  };
};

/**
 * Calculates availability details for a given room type within a date range.
 * 
 * @param {string} roomType - Room type name
 * @param {Date|string} startDate - Range start date (inclusive)
 * @param {Date|string} endDate - Range end date (exclusive)
 * @returns {Promise<{roomType: string, inventory: number, available: number, fullyBookedDates: string[], limitedAvailabilityDates: string[]}>}
 */
const getRoomTypeAvailability = async (roomType, startDate, endDate) => {
  const start = new Date(startDate);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setUTCHours(0, 0, 0, 0);

  if (end <= start) {
    throw new Error('End date must be after start date');
  }

  // Get total inventory of active rooms of this type
  const activeRooms = await Room.find({ type: roomType, isActive: true }).select('_id');
  const inventory = activeRooms.length;

  if (inventory === 0) {
    return {
      roomType,
      inventory: 0,
      available: 0,
      fullyBookedDates: [],
      limitedAvailabilityDates: [],
    };
  }

  // Find all active inventory-blocking bookings that overlap with the range [start, end]
  const bookings = await Booking.find({
    roomType,
    status: { $in: ['confirmed', 'allocated', 'paid', 'checked_in'] },
    checkInDate: { $lt: end },
    checkOutDate: { $gt: start },
  }).select('_id checkInDate checkOutDate status paymentStatus');

  const fullyBookedDates = [];
  const limitedAvailabilityDates = [];
  let minAvailable = inventory;

  const cursor = new Date(start);
  while (cursor < end) {
    const cursorStr = cursor.toISOString().split('T')[0];
    const cursorTime = cursor.getTime();

    // Count overlapping bookings for this specific day
    let bookedCount = 0;
    for (const b of bookings) {
      const bIn = new Date(b.checkInDate);
      bIn.setUTCHours(0, 0, 0, 0);
      const bOut = new Date(b.checkOutDate);
      bOut.setUTCHours(0, 0, 0, 0);

      if (bIn.getTime() <= cursorTime && bOut.getTime() > cursorTime) {
        bookedCount++;
      }
    }

    const remaining = Math.max(0, inventory - bookedCount);
    if (remaining === 0) {
      fullyBookedDates.push(cursorStr);
    } else if (remaining < inventory) {
      limitedAvailabilityDates.push(cursorStr);
    }

    if (remaining < minAvailable) {
      minAvailable = remaining;
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    roomType,
    inventory,
    available: minAvailable,
    fullyBookedDates,
    limitedAvailabilityDates,
  };
};

module.exports = {
  getRoomTypeAvailability,
  acquireLock,
};
