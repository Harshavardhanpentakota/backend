const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const Booking = require('../models/Booking');

const uri = process.env.MONGODB_URI;

async function run() {
  await mongoose.connect(uri);
  console.log('Connected to DB');

  const payments = await Payment.collection.find({ isDeleted: { $ne: true } }).toArray();
  let orphanedPayments = 0;
  for (const p of payments) {
    if (p.booking) {
      const b = await Booking.collection.findOne({ _id: p.booking });
      if (b && b.isDeleted) {
        orphanedPayments++;
        console.log(`Orphaned Payment: ${p.transactionId || p._id} for Booking ${b.bookingId}`);
      }
    }
  }

  const invoices = await Invoice.collection.find({ isDeleted: { $ne: true } }).toArray();
  let orphanedInvoices = 0;
  for (const inv of invoices) {
    if (inv.booking) {
      const b = await Booking.collection.findOne({ _id: inv.booking });
      if (b && b.isDeleted) {
        orphanedInvoices++;
        console.log(`Orphaned Invoice: ${inv.invoiceNumber} for Booking ${b.bookingId}`);
      }
    }
  }

  console.log(`Remaining orphaned payments: ${orphanedPayments}`);
  console.log(`Remaining orphaned invoices: ${orphanedInvoices}`);

  await mongoose.disconnect();
}

run().catch(console.error);
