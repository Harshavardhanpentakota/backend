'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('No MONGODB_URI found in env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const Booking = mongoose.model('Booking', new mongoose.Schema({}, { strict: false }));
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));

  // Find users with non-deleted bookings
  const activeBookings = await Booking.find({ isDeleted: { $ne: true } }).select('user');
  const userIds = [...new Set(activeBookings.map(b => b.user ? b.user.toString() : null).filter(Boolean))];
  
  console.log('Found user IDs with active bookings:', userIds);

  const res = await User.updateMany(
    { _id: { $in: userIds } },
    { isDeleted: false }
  );

  console.log('Updated users result:', res);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
