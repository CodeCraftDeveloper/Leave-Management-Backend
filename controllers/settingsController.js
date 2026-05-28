import asyncHandler from 'express-async-handler';
import Settings from '../models/Settings.js';

// GET /api/settings   (any authenticated user — they need the rules)
export const getSettings = asyncHandler(async (req, res) => {
  const settings = await Settings.get();
  res.json(settings);
});

// PATCH /api/settings  (admin only)
export const updateSettings = asyncHandler(async (req, res) => {
  if (req.user.role !== 'head') {
    res.status(403);
    throw new Error('Head access required');
  }
  const settings = await Settings.get();
  const allowed = ['workStartTime', 'workEndTime', 'weekOffDays', 'perDayMode', 'monthlyFreeLeaves', 'sundayMinHours', 'sundayPayMultiplier'];
  for (const k of allowed) {
    if (req.body[k] !== undefined) settings[k] = req.body[k];
  }
  await settings.save();
  res.json(settings);
});
