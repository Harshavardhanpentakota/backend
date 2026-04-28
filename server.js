'use strict';

require('dotenv').config();

const app = require('./src/app');
const connectDB = require('./src/config/db');
const logger = require('./src/utils/logger');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  const server = app.listen(PORT, () => {
    logger.info(`🏨 Hotel Abhitej Inn API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    logger.info(`📍 Health: http://localhost:${PORT}/health`);
    logger.info(`📡 API:    http://localhost:${PORT}${process.env.API_PREFIX || '/api'}`);
  });

  // Graceful shutdown
  const shutdown = (signal) => {
    logger.info(`${signal} received — shutting down gracefully...`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    // Force close after 10s
    setTimeout(() => {
      logger.error('Force shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled Rejection: ${reason}`);
    server.close(() => process.exit(1));
  });
};

startServer();
