import asyncHandler from 'express-async-handler';
import Holiday from '../models/Holiday.js';

// @desc Get all holidays
// @route GET /api/holidays
export const getHolidays = asyncHandler(async (req, res) => {
  const holidays = await Holiday.find().sort({ date: 1 });
  res.json(holidays);
});

// @desc Add a new holiday
// @route POST /api/admin/holidays
export const createHoliday = asyncHandler(async (req, res) => {
  const { name, date, description } = req.body;

  if (!name || !date) {
    res.status(400);
    throw new Error('Name and date are required');
  }

  const holidayDate = new Date(date);
  if (isNaN(holidayDate)) {
    res.status(400);
    throw new Error('Invalid holiday date');
  }

  // Clear time portion for consistency
  holidayDate.setHours(0, 0, 0, 0);

  const existing = await Holiday.findOne({ date: holidayDate });
  if (existing) {
    res.status(400);
    throw new Error('A holiday already exists on this date');
  }

  const holiday = await Holiday.create({
    name,
    date: holidayDate,
    description,
  });

  res.status(201).json(holiday);
});

// @desc Delete a holiday
// @route DELETE /api/admin/holidays/:id
export const deleteHoliday = asyncHandler(async (req, res) => {
  const holiday = await Holiday.findById(req.params.id);

  if (!holiday) {
    res.status(404);
    throw new Error('Holiday not found');
  }

  await holiday.deleteOne();
  res.json({ message: 'Holiday removed' });
});
