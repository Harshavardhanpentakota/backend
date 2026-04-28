'use strict';

const jwt = require('jsonwebtoken');

const generateAccessToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    issuer: 'hotel-abhitej-inn',
    audience: 'hotel-abhitej-inn-client',
  });

const generateRefreshToken = (payload) =>
  jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    issuer: 'hotel-abhitej-inn',
  });

const verifyAccessToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET, {
    issuer: 'hotel-abhitej-inn',
    audience: 'hotel-abhitej-inn-client',
  });

const verifyRefreshToken = (token) =>
  jwt.verify(token, process.env.JWT_REFRESH_SECRET, {
    issuer: 'hotel-abhitej-inn',
  });

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
