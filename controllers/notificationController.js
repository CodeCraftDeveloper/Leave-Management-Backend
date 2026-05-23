import asyncHandler from 'express-async-handler';
import Notification from '../models/Notification.js';

export const getMyNotifications = asyncHandler(async (req, res) => {
  const items = await Notification.find({ recipient: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50);
  const unread = await Notification.countDocuments({ recipient: req.user._id, read: false });
  res.json({ items, unread });
});

export const markRead = asyncHandler(async (req, res) => {
  const n = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.user._id },
    { read: true },
    { new: true }
  );
  if (!n) {
    res.status(404);
    throw new Error('Notification not found');
  }
  res.json(n);
});

export const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ recipient: req.user._id, read: false }, { read: true });
  res.json({ message: 'All marked read' });
});
