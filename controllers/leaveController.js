import asyncHandler from 'express-async-handler';
import Leave from '../models/Leave.js';
import Notification from '../models/Notification.js';
import Holiday from '../models/Holiday.js';
import { calculateDays, datesOverlap } from '../utils/calculateDays.js';
import { sendLeaveAppliedEmails, sendLeaveStatusEmail } from '../services/emailService.js';

// @desc Apply leave
// @route POST /api/leaves
export const applyLeave = asyncHandler(async (req, res) => {
  const { leaveType, startDate, endDate, reason, isHalfDay, halfDaySession } = req.body;
  if (!leaveType || !startDate || !endDate || !reason) {
    res.status(400);
    throw new Error('All fields are required');
  }
  const isHalfDayBool = String(isHalfDay) === 'true';

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start) || isNaN(end)) {
    res.status(400);
    throw new Error('Invalid dates');
  }
  if (end < start) {
    res.status(400);
    throw new Error('End date cannot be before start date');
  }

  const holidays = await Holiday.find({});

  let totalDays = 0;
  if (isHalfDayBool) {
    // For half day, start and end date must be same
    const startStr = start.toDateString();
    const endStr = end.toDateString();
    if (startStr !== endStr) {
      res.status(400);
      throw new Error('Start date and End date must be the same for half-day leave');
    }
    if (!['first_half', 'second_half'].includes(halfDaySession)) {
      res.status(400);
      throw new Error('Valid half-day session (first_half or second_half) is required');
    }
    const workingDaysCount = calculateDays(start, end, holidays);
    if (workingDaysCount === 0) {
      res.status(400);
      throw new Error('Cannot apply for half-day leave on a Sunday');
    }
    totalDays = 0.5;
  } else {
    totalDays = calculateDays(start, end, holidays);
    if (totalDays === 0) {
      res.status(400);
      throw new Error('The requested range contains no countable leave days');
    }
  }

  // Check overlap
  const overlapping = await Leave.find({
    employee: req.user._id,
    status: { $in: ['pending', 'approved'] },
  });
  
  const isOverlap = overlapping.some((l) => {
    if (!datesOverlap(l.startDate, l.endDate, start, end)) {
      return false;
    }
    const lStart = new Date(l.startDate);
    const lEnd = new Date(l.endDate);
    lStart.setHours(0, 0, 0, 0);
    lEnd.setHours(0, 0, 0, 0);
    const reqStart = new Date(start);
    const reqEnd = new Date(end);
    reqStart.setHours(0, 0, 0, 0);
    reqEnd.setHours(0, 0, 0, 0);

    if (lStart.getTime() === reqStart.getTime() && lEnd.getTime() === reqEnd.getTime() && l.isHalfDay && isHalfDayBool) {
      if (l.halfDaySession !== halfDaySession) {
        return false;
      }
    }
    return true;
  });

  if (isOverlap) {
    res.status(400);
    throw new Error('You already have a leave request overlapping these dates');
  }

  const attachment = req.file ? `/uploads/${req.file.filename}` : '';

  const leave = await Leave.create({
    employee: req.user._id,
    leaveType,
    startDate: start,
    endDate: end,
    totalDays,
    reason,
    attachment,
    isHalfDay: isHalfDayBool,
    halfDaySession: isHalfDayBool ? halfDaySession : '',
  });

  await Notification.create({
    recipient: req.user._id,
    title: 'Leave Submitted',
    message: `Your ${leaveType} leave request for ${totalDays} day(s) is pending review.`,
    type: 'info',
  });

  sendLeaveAppliedEmails({ employee: req.user, leave }).catch(() => {});

  res.status(201).json(leave);
});

// @desc Get my leaves
// @route GET /api/leaves/mine
export const getMyLeaves = asyncHandler(async (req, res) => {
  const { status, type, page = 1, limit = 20 } = req.query;
  const filter = { employee: req.user._id };
  if (status) filter.status = status;
  if (type) filter.leaveType = type;

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    Leave.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Leave.countDocuments(filter),
  ]);
  res.json({ items, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
});

// @desc Get leave by id
// @route GET /api/leaves/:id
export const getLeaveById = asyncHandler(async (req, res) => {
  const leave = await Leave.findById(req.params.id).populate('employee', 'name employeeId department email');
  if (!leave) {
    res.status(404);
    throw new Error('Leave not found');
  }
  if (req.user.role !== 'admin' && leave.employee._id.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized');
  }
  res.json(leave);
});

// @desc Cancel my pending leave
// @route PATCH /api/leaves/:id/cancel
export const cancelLeave = asyncHandler(async (req, res) => {
  const leave = await Leave.findById(req.params.id);
  if (!leave) {
    res.status(404);
    throw new Error('Leave not found');
  }
  if (leave.employee.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized');
  }
  if (leave.status !== 'pending') {
    res.status(400);
    throw new Error('Only pending leaves can be cancelled');
  }
  leave.status = 'cancelled';
  await leave.save();
  res.json(leave);
});

// @desc My leave summary
// @route GET /api/leaves/summary
export const getMySummary = asyncHandler(async (req, res) => {
  const employeeId = req.user._id;
  const [pending, approved, rejected, cancelled] = await Promise.all([
    Leave.countDocuments({ employee: employeeId, status: 'pending' }),
    Leave.countDocuments({ employee: employeeId, status: 'approved' }),
    Leave.countDocuments({ employee: employeeId, status: 'rejected' }),
    Leave.countDocuments({ employee: employeeId, status: 'cancelled' }),
  ]);

  const upcoming = await Leave.find({
    employee: employeeId,
    status: 'approved',
    startDate: { $gte: new Date() },
  })
    .sort({ startDate: 1 })
    .limit(5);

  const recent = await Leave.find({ employee: employeeId }).sort({ createdAt: -1 }).limit(5);

  res.json({
    counts: { pending, approved, rejected, cancelled },
    leaveBalance: req.user.leaveBalance,
    upcoming,
    recent,
  });
});

// @desc Approved leaves for calendar
// @route GET /api/leaves/calendar
export const getCalendarLeaves = asyncHandler(async (req, res) => {
  const { from, to, all } = req.query;
  const filter = { status: 'approved' };
  if (req.user.role !== 'admin' || !all) filter.employee = req.user._id;
  if (from && to) {
    filter.startDate = { $lte: new Date(to) };
    filter.endDate = { $gte: new Date(from) };
  }
  const leaves = await Leave.find(filter).populate('employee', 'name employeeId department');
  res.json(leaves);
});
