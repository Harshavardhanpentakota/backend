const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const Payment = require('../models/Payment');
const Booking = require('../models/Booking');

const uri = process.env.MONGODB_URI;

async function run() {
  await mongoose.connect(uri);
  console.log('Connected to DB');

  const payments = await Payment.collection.find({
    transactionId: { $in: ['OUT-CASH-1781955403227', 'ADV-CASH-1781955337757'] }
  }).toArray();

  console.log(`Found ${payments.length} matching payments:`);
  for (const p of payments) {
    console.log(`Payment ID: ${p._id}, Transaction: ${p.transactionId}`);
    console.log(`- Booking field value: ${p.booking}`);
    console.log(`- User field value: ${p.user}`);
    console.log(`- isDeleted: ${p.isDeleted}`);

    if (p.booking) {
      const b = await Booking.collection.findOne({ _id: p.booking });
      if (b) {
        console.log(`  -> Booking document exists! isDeleted: ${b.isDeleted}, Booking ID: ${b.bookingId}`);
      } else {
        console.log(`  -> Booking document does NOT exist in the collection!`);
      }
    }
  }

  await mongoose.disconnect();
}

run().catch(console.error);
