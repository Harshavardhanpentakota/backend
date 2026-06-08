'use strict';

const EventEmitter = require('events');
const notificationEmitter = new EventEmitter();
notificationEmitter.setMaxListeners(0);

module.exports = {
  notificationEmitter,
};
