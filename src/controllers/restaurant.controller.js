'use strict';

const RestaurantOrder = require('../models/RestaurantOrder');
const { sendSuccess, sendError, paginationMeta } = require('../utils/response');
const { parsePagination, addGST } = require('../utils/helpers');
const { ORDER_STATUS } = require('../constants');

// POST /api/restaurant/orders
const createOrder = async (req, res, next) => {
  try {
    const { roomId, bookingId, items, specialInstructions } = req.body;

    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const { tax, totalPrice } = { ...addGST(subtotal, 5), totalPrice: addGST(subtotal, 5).totalAmount };

    const order = await RestaurantOrder.create({
      room: roomId,
      booking: bookingId,
      orderedBy: req.user._id,
      items,
      subtotal,
      tax,
      totalPrice: subtotal + tax,
      specialInstructions,
    });

    return sendSuccess(res, 201, 'Order placed successfully', order);
  } catch (error) {
    next(error);
  }
};

// GET /api/restaurant/orders
const getOrders = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { status, roomId } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (roomId) filter.room = roomId;

    // Non-admin users see only their own orders
    if (req.user.role === 'user') filter.orderedBy = req.user._id;

    const [orders, total] = await Promise.all([
      RestaurantOrder.find(filter)
        .populate('room', 'roomNumber floor')
        .populate('orderedBy', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      RestaurantOrder.countDocuments(filter),
    ]);

    return sendSuccess(res, 200, 'Orders fetched', orders, paginationMeta(total, page, limit));
  } catch (error) {
    next(error);
  }
};

// PATCH /api/restaurant/orders/:id/status
const updateOrderStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    const updates = { status };
    if (status === ORDER_STATUS.DELIVERED) updates.deliveredAt = new Date();

    const order = await RestaurantOrder.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    if (!order) return sendError(res, 404, 'Order not found');
    return sendSuccess(res, 200, 'Order status updated', order);
  } catch (error) {
    next(error);
  }
};

module.exports = { createOrder, getOrders, updateOrderStatus };
