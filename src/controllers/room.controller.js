'use strict';

const Room = require('../models/Room');
const Booking = require('../models/Booking');
const { sendSuccess, sendError, paginationMeta } = require('../utils/response');
const { parsePagination } = require('../utils/helpers');
const { BOOKING_STATUS, ROOM_STATUS } = require('../constants');
const { getRoomTypeAvailability } = require('../utils/availability');
const { logActivity } = require('../utils/activity');

// GET /api/rooms  — list rooms with filtering, search, pagination
const getRooms = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { type, status, minPrice, maxPrice, floor, search, checkIn, checkOut } = req.query;

    const filter = { isActive: true };
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (floor) filter.floor = parseInt(floor, 10);
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = parseFloat(minPrice);
      if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
    }
    if (search) {
      filter.$or = [
        { roomNumber: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    // Filter by date availability
    if (checkIn && checkOut) {
      const checkInDate = new Date(checkIn);
      const checkOutDate = new Date(checkOut);
      if (checkOutDate > checkInDate) {
        const bookedRoomIds = await Booking.find({
          status: { $in: ['confirmed', 'allocated', 'paid', 'checked_in'] },
          checkInDate: { $lt: checkOutDate },
          checkOutDate: { $gt: checkInDate },
        }).distinct('room');
        filter._id = { $nin: bookedRoomIds };
      }
    }

    const [rooms, total] = await Promise.all([
      Room.find(filter).sort({ floor: 1, roomNumber: 1 }).skip(skip).limit(limit),
      Room.countDocuments(filter),
    ]);

    return sendSuccess(res, 200, 'Rooms fetched', rooms, paginationMeta(total, page, limit));
  } catch (error) {
    next(error);
  }
};

// GET /api/rooms/available  — rooms available between dates
const getAvailableRooms = async (req, res, next) => {
  try {
    const { checkIn, checkOut, type, guests } = req.query;

    if (!checkIn || !checkOut) {
      return sendError(res, 400, 'checkIn and checkOut query parameters are required');
    }

    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);

    if (checkOutDate <= checkInDate) {
      return sendError(res, 400, 'Check-out date must be after check-in date');
    }

    // Find all rooms that have conflicting bookings
    const conflictingBookings = await Booking.find({
      status: { $in: ['confirmed', 'allocated', 'paid', 'checked_in'] },
      $or: [
        { checkInDate: { $lt: checkOutDate }, checkOutDate: { $gt: checkInDate } },
      ],
    }).distinct('room');

    const filter = {
      _id: { $nin: conflictingBookings },
      status: ROOM_STATUS.AVAILABLE,
      isActive: true,
    };

    if (type) filter.type = type;
    if (guests) filter.capacity = { $gte: parseInt(guests, 10) };

    const rooms = await Room.find(filter).sort({ price: 1 });

    return sendSuccess(res, 200, 'Available rooms fetched', rooms, {
      checkIn: checkInDate,
      checkOut: checkOutDate,
      count: rooms.length,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/rooms/:id
const getRoomById = async (req, res, next) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room || !room.isActive) {
      return sendError(res, 404, 'Room not found');
    }
    return sendSuccess(res, 200, 'Room fetched', room);
  } catch (error) {
    next(error);
  }
};

// POST /api/rooms  (admin only)
const createRoom = async (req, res, next) => {
  try {
    // Auto-fill price based on room type if not provided
    if (req.body.price === undefined || req.body.price === null || req.body.price === '') {
      const existing = await Room.findOne({ type: req.body.type, isActive: true });
      if (existing) {
        req.body.price = existing.price;
      } else {
        const defaults = {
          'Deluxe Non AC': 1800,
          'Deluxe AC': 2800,
          'Suite': 5400,
        };
        req.body.price = defaults[req.body.type] || 2000;
      }
    }
    const room = await Room.create(req.body);

    await logActivity({
      req,
      action: 'Room Created',
      module: 'Rooms',
      entityId: room._id.toString(),
      entityType: 'Room',
      description: `Room ${room.roomNumber} created.`,
      newData: room.toObject()
    });

    return sendSuccess(res, 201, 'Room created successfully', room);
  } catch (error) {
    next(error);
  }
};

// PUT /api/rooms/:id  (admin only)
const updateRoom = async (req, res, next) => {
  try {
    const oldRoom = await Room.findById(req.params.id);
    const room = await Room.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!room) return sendError(res, 404, 'Room not found');

    await logActivity({
      req,
      action: 'Room Updated',
      module: 'Rooms',
      entityId: room._id.toString(),
      entityType: 'Room',
      description: `Room ${room.roomNumber} updated.`,
      previousData: oldRoom ? oldRoom.toObject() : null,
      newData: room.toObject()
    });

    return sendSuccess(res, 200, 'Room updated successfully', room);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/rooms/:id  (admin only — soft delete)
const deleteRoom = async (req, res, next) => {
  try {
    // Check for active bookings
    const activeBooking = await Booking.findOne({
      room: req.params.id,
      status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CHECKED_IN] },
    });

    if (activeBooking) {
      return sendError(res, 409, 'Cannot delete room with active bookings');
    }

    const oldRoom = await Room.findById(req.params.id);
    const room = await Room.findByIdAndUpdate(
      req.params.id,
      { isActive: false, status: ROOM_STATUS.MAINTENANCE },
      { new: true }
    );

    if (!room) return sendError(res, 404, 'Room not found');

    await logActivity({
      req,
      action: 'Room Deleted',
      module: 'Rooms',
      entityId: req.params.id,
      entityType: 'Room',
      description: `Room deleted: ${oldRoom ? oldRoom.roomNumber : req.params.id}`
    });

    return sendSuccess(res, 200, 'Room deleted successfully');
  } catch (error) {
    next(error);
  }
};

// GET /api/rooms/:id/booked-dates  — public
const getRoomBookedDates = async (req, res, next) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room || !room.isActive) {
      return sendError(res, 404, 'Room not found');
    }

    const bookings = await Booking.find({
      room: req.params.id,
      status: { $in: ['confirmed', 'allocated', 'paid', 'checked_in'] },
      checkOutDate: { $gte: new Date() },
    }).select('checkInDate checkOutDate -_id');

    return sendSuccess(res, 200, 'Booked dates fetched', bookings);
  } catch (error) {
    next(error);
  }
};

// GET /api/rooms/type-unavailable-dates?type=Suite&year=2026&month=5
const getTypeUnavailableDates = async (req, res, next) => {
  try {
    const { type, year, month } = req.query;
    if (!type) return sendError(res, 400, 'Room type is required');

    const rooms = await Room.find({ type, isActive: true }).select('_id');
    const roomIds = rooms.map((r) => r._id);
    const totalRooms = roomIds.length;

    if (totalRooms === 0) {
      return sendSuccess(res, 200, 'Unavailable dates fetched', { dates: [] });
    }

    let startDate, endDate;
    if (year && month) {
      startDate = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
      endDate = new Date(parseInt(year, 10), parseInt(month, 10), 1);
    } else {
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 90);
    }

    const bookings = await Booking.find({
      room: { $in: roomIds },
      status: { $in: ['confirmed', 'allocated', 'paid', 'checked_in'] },
      checkInDate: { $lt: endDate },
      checkOutDate: { $gt: startDate },
    }).select('room checkInDate checkOutDate -_id');

    const fullyBookedDates = [];
    const cursor = new Date(startDate);
    while (cursor < endDate) {
      const dateStart = new Date(cursor);
      const dateEnd = new Date(cursor);
      dateEnd.setDate(dateEnd.getDate() + 1);

      const bookedRoomIds = new Set();
      for (const booking of bookings) {
        const ci = new Date(booking.checkInDate);
        const co = new Date(booking.checkOutDate);
        if (ci < dateEnd && co > dateStart) {
          bookedRoomIds.add(booking.room.toString());
        }
      }

      if (bookedRoomIds.size >= totalRooms) {
        fullyBookedDates.push(dateStart.toISOString().split('T')[0]);
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return sendSuccess(res, 200, 'Unavailable dates fetched', { dates: fullyBookedDates });
  } catch (error) {
    next(error);
  }
};

// GET /api/rooms/:roomType/availability
const getRoomTypeAvailabilityAPI = async (req, res, next) => {
  try {
    const { roomType } = req.params;
    const { checkIn, checkOut, year, month } = req.query;

    let startDate, endDate;
    if (year && month) {
      startDate = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
      endDate = new Date(parseInt(year, 10), parseInt(month, 10), 1);
    } else if (checkIn) {
      startDate = new Date(checkIn);
      if (checkOut) {
        endDate = new Date(checkOut);
      } else {
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 90);
      }
    } else {
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 90);
    }

    if (endDate <= startDate) {
      return sendError(res, 400, 'Check-out/End date must be after check-in/Start date');
    }

    const availability = await getRoomTypeAvailability(roomType, startDate, endDate);
    
    return sendSuccess(res, 200, 'Availability calculated successfully', {
      roomType: availability.roomType,
      inventory: availability.inventory,
      available: availability.available,
      fullyBookedDates: availability.fullyBookedDates,
      limitedAvailabilityDates: availability.limitedAvailabilityDates,
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/rooms/:id/status  (admin / receptionist)
const updateRoomStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!Object.values(ROOM_STATUS).includes(status)) {
      return sendError(res, 400, 'Invalid room status');
    }

    const oldRoom = await Room.findById(req.params.id);
    const room = await Room.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

    if (!room) return sendError(res, 404, 'Room not found');

    await logActivity({
      req,
      action: 'Room Status Changed',
      module: 'Rooms',
      entityId: room._id.toString(),
      entityType: 'Room',
      description: `Room ${room.roomNumber} status changed from ${oldRoom ? oldRoom.status : 'unknown'} to ${status}. Room marked ${status === 'available' ? 'available' : 'unavailable'}.`,
      previousData: oldRoom ? { status: oldRoom.status } : null,
      newData: { status }
    });

    return sendSuccess(res, 200, 'Room status updated', room);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getRooms,
  getAvailableRooms,
  getRoomById,
  getRoomBookedDates,
  getTypeUnavailableDates,
  getRoomTypeAvailabilityAPI,
  createRoom,
  updateRoom,
  deleteRoom,
  updateRoomStatus,
};
