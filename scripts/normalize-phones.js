'use strict';

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../src/models/User');

const normalizePhone = (phone) => {
  if (!phone) return phone;
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits;
};

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Database connected.');

    const users = await User.find({});
    console.log(`Found ${users.length} users.`);

    let updatedCount = 0;
    for (const user of users) {
      if (user.phone) {
        const norm = normalizePhone(user.phone);
        if (norm !== user.phone) {
          console.log(`Updating user ${user.name}: "${user.phone}" -> "${norm}"`);
          user.phone = norm;
          await user.save({ validateBeforeSave: false });
          updatedCount++;
        }
      }
    }

    console.log(`Migration complete. Updated ${updatedCount} users.`);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

run();
