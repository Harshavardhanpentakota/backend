'use strict';
const fs = require('fs');
const path = require('path');

const f = path.join(__dirname, 'src/controllers/receptionist.controller.js');
let text = fs.readFileSync(f, 'utf8');

const start = text.indexOf('const checkIn = async');
const end = text.indexOf('\n// ', start + 50);

if (start === -1) { console.error('checkIn not found'); process.exit(1); }

console.log(`Replacing checkIn: chars ${start} to ${end}`);

const oldFn = text.slice(start, end);

const newFn = `const checkIn = async (req, res, next) => {
  try {
    const { bookingId, advancePaymentMethod = 'cash', roomId } = req.body;

    const booking = await Booking.findOne({ bookingId });
    if (!booking) return sendError(res, 404, 'Booking not found');

    if (booking.status !== BOOKING_STATUS.CONFIRMED) {
      return sendError(res, 409, \`Cannot check in - booking status is: \${booking.status}\`);
    }

    // If booking has no room assigned yet (type-based online booking), assign now
    if (!booking.room) {
      if (!roomId) {
        return sendError(res, 400, 'A room must be assigned before check-in. Please provide roomId.');
      }
      const assignedRoom = await Room.findById(roomId);
      if (!assignedRoom || !assignedRoom.isActive) {
        return sendError(res, 404, 'Room not found');
      }
      if (assignedRoom.type !== booking.roomType) {
        return sendError(res, 400, \`Room type mismatch: booking requires "\${booking.roomType}" but selected room is "\${assignedRoom.type}"\`);
      }
      if (assignedRoom.status === ROOM_STATUS.MAINTENANCE) {
        return sendError(res, 409, 'Selected room is under maintenance');
      }
      const conflict = await Booking.findOne({
        room: roomId,
        status: BOOKING_STATUS.CHECKED_IN,
        _id: { $ne: booking._id },
      });
      if (conflict) return sendError(res, 409, 'Selected room is currently occupied');
      booking.room = roomId;
    }

    await booking.populate('room');

    const settings = await HotelSettings.getSettings();
    const advancePct = settings.advancePaymentPercent;
    const advancePaid = Math.round((booking.subtotal * advancePct) / 100);

    booking.status = BOOKING_STATUS.CHECKED_IN;
    booking.actualCheckIn = new Date();
    booking.advancePaid = advancePaid;
    booking.advancePaidAt = new Date();
    booking.advancePaymentMethod = advancePaymentMethod;
    await booking.save();

    await Room.findByIdAndUpdate(booking.room._id, { status: ROOM_STATUS.OCCUPIED });

    logger.info(\`Check-in: \${bookingId} | Room: \${booking.room.roomNumber} | Advance paid\`);
    return sendSuccess(res, 200, 'Guest checked in successfully', {
      bookingId: booking.bookingId,
      room: \`Room \${booking.room.roomNumber}\`,
      checkInTime: booking.actualCheckIn,
      advancePaid,
      advancePct,
      advancePaymentMethod,
    });
  } catch (error) {
    next(error);
  }
};`;

const newText = text.slice(0, start) + newFn + text.slice(end);
fs.writeFileSync(f, newText, 'utf8');
console.log('Done. Written', newText.length, 'chars');
