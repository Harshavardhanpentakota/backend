'use strict';

const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    logger.error('MONGODB_URI is not defined in environment variables');
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(uri, {
      autoIndex: process.env.NODE_ENV !== 'production',
    });

    logger.info(`MongoDB connected: ${conn.connection.host} — DB: ${conn.connection.name}`);

    // Drop non-sparse unique email index on users if it is not sparse
    try {
      const db = mongoose.connection.db;
      const collections = await db.listCollections({ name: 'users' }).toArray();
      if (collections.length > 0) {
        const indexes = await db.collection('users').indexes();
        const emailIndex = indexes.find(idx => idx.name === 'email_1');
        if (emailIndex && !emailIndex.sparse) {
          logger.info('Dropping non-sparse email index on users collection...');
          await db.collection('users').dropIndex('email_1');
        }
      }
    } catch (indexErr) {
      logger.warn(`Could not check/drop email index: ${indexErr.message}`);
    }

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected.');
    });

    mongoose.connection.on('error', (err) => {
      logger.error(`MongoDB connection error: ${err.message}`);
    });
  } catch (error) {
    logger.error(`MongoDB initial connection failed: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
