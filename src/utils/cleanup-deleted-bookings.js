const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const User = require('../models/User');

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('MONGODB_URI is not defined in the environment variables.');
  process.exit(1);
}

async function run() {
  await mongoose.connect(uri);
  console.log('Connected to Database successfully.');

  // Use raw collection to bypass the mongoose find middleware
  const deletedBookings = await Booking.collection.find({ isDeleted: true }).toArray();
  console.log(`Found ${deletedBookings.length} already soft-deleted bookings.`);

  for (const booking of deletedBookings) {
    console.log(`Cleaning up for booking ID #${booking.bookingId} (${booking._id})`);

    // Soft delete associated payments
    const payRes = await Payment.updateMany({ booking: booking._id }, { isDeleted: true });
    console.log(`- Soft-deleted payments: ${payRes.modifiedCount}`);

    // Soft delete associated invoices
    const invRes = await Invoice.updateMany({ booking: booking._id }, { isDeleted: true });
    console.log(`- Soft-deleted invoices: ${invRes.modifiedCount}`);

    // Soft delete associated user
    if (booking.user) {
      const userRes = await User.findByIdAndUpdate(booking.user, { isDeleted: true });
      if (userRes) {
        console.log(`- Soft-deleted user: ${booking.user}`);
      }
    }
  }

  console.log('Migration cleanup complete.');
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
