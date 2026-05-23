import asyncHandler from 'express-async-handler';
import Leave from '../models/Leave.js';
import Employee from '../models/Employee.js';
import Notification from '../models/Notification.js';
import Holiday from '../models/Holiday.js';
import { calculateDays, datesOverlap } from '../utils/calculateDays.js';
import { sendLeaveStatusEmail } from '../services/emailService.js';

// @desc Admin dashboard stats
// @route GET /api/admin/dashboard
export const getDashboard = asyncHandler(async (req, res) => {
  const [totalEmployees, pending, approved, rejected] = await Promise.all([
    Employee.countDocuments({ role: 'employee', active: true }),
    Leave.countDocuments({ status: 'pending' }),
    Leave.countDocuments({ status: 'approved' }),
    Leave.countDocuments({ status: 'rejected' }),
  ]);

  // Monthly analytics for current year
  const year = new Date().getFullYear();
  const monthly = await Leave.aggregate([
    {
      $match: {
        createdAt: { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31`) },
      },
    },
    {
      $group: {
        _id: { month: { $month: '$createdAt' }, status: '$status' },
        count: { $sum: 1 },
      },
    },
  ]);

  const monthlyMap = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    pending: 0,
    approved: 0,
    rejected: 0,
  }));
  monthly.forEach((m) => {
    const row = monthlyMap[m._id.month - 1];
    if (row && row[m._id.status] !== undefined) row[m._id.status] = m.count;
  });

  const recent = await Leave.find()
    .sort({ createdAt: -1 })
    .limit(8)
    .populate('employee', 'name employeeId department');

  res.json({
    stats: { totalEmployees, pending, approved, rejected },
    monthly: monthlyMap,
    recent,
  });
});

// @desc Get all leave requests with filters
// @route GET /api/admin/leaves
export const getAllLeaves = asyncHandler(async (req, res) => {
  const { status, type, search, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (type) filter.leaveType = type;

  let employeeFilter = {};
  if (search) {
    employeeFilter = {
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
      ],
    };
    const employees = await Employee.find(employeeFilter).select('_id');
    filter.employee = { $in: employees.map((e) => e._id) };
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    Leave.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('employee', 'name employeeId department email'),
    Leave.countDocuments(filter),
  ]);

  res.json({ items, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
});

// @desc Approve/Reject leave
// @route PATCH /api/admin/leaves/:id
export const updateLeaveStatus = asyncHandler(async (req, res) => {
  const { status, adminComment } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    res.status(400);
    throw new Error('Invalid status');
  }
  const leave = await Leave.findById(req.params.id).populate('employee');
  if (!leave) {
    res.status(404);
    throw new Error('Leave not found');
  }
  if (leave.status !== 'pending') {
    res.status(400);
    throw new Error(`Leave already ${leave.status}`);
  }

  leave.status = status;
  leave.adminComment = adminComment || '';
  leave.actionedBy = req.user._id;
  leave.actionedAt = new Date();
  await leave.save();

  if (status === 'approved') {
    const employee = await Employee.findById(leave.employee._id);
    const balance = { ...employee.leaveBalance };
    if (balance[leave.leaveType] !== undefined) {
      balance[leave.leaveType] = Math.max(0, balance[leave.leaveType] - leave.totalDays);
      employee.leaveBalance = balance;
      employee.markModified('leaveBalance');
      await employee.save();
    }
  }

  await Notification.create({
    recipient: leave.employee._id,
    title: `Leave ${status}`,
    message: `Your ${leave.leaveType} leave has been ${status}.${adminComment ? ' Note: ' + adminComment : ''}`,
    type: status === 'approved' ? 'success' : 'error',
  });

  sendLeaveStatusEmail({ employee: leave.employee, leave }).catch(() => {});

  res.json(leave);
});

// @desc Get all employees
// @route GET /api/admin/employees
export const getEmployees = asyncHandler(async (req, res) => {
  const { search, department, page = 1, limit = 20 } = req.query;
  const filter = { role: 'employee' };
  if (department) filter.department = department;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { employeeId: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }
  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    Employee.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Employee.countDocuments(filter),
  ]);
  res.json({ items, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
});

// @desc Employee detail with leaves
// @route GET /api/admin/employees/:id
export const getEmployeeDetail = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.id);
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }
  const leaves = await Leave.find({ employee: employee._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ employee, leaves });
});

// @desc Apply leave on behalf of employee (Auto-approved)
// @route POST /api/admin/leaves
export const applyLeaveOnBehalf = asyncHandler(async (req, res) => {
  const { employeeId, leaveType, startDate, endDate, reason, isHalfDay, halfDaySession } = req.body;

  if (!employeeId || !leaveType || !startDate || !endDate || !reason) {
    res.status(400);
    throw new Error('All fields are required');
  }

  const employee = await Employee.findById(employeeId);
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
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
      throw new Error('Cannot apply for half-day leave on a weekend or holiday');
    }
    totalDays = 0.5;
  } else {
    totalDays = calculateDays(start, end, holidays);
    if (totalDays === 0) {
      res.status(400);
      throw new Error('The requested range contains 0 working days (weekends/holidays only)');
    }
  }

  // Validate balance
  const currentBalance = employee.leaveBalance[leaveType];
  if (currentBalance === undefined) {
    res.status(400);
    throw new Error('Invalid leave type');
  }
  if (currentBalance < totalDays) {
    res.status(400);
    throw new Error(`Insufficient leave balance. Remaining: ${currentBalance} days, requested: ${totalDays} days.`);
  }

  // Check overlap
  const overlapping = await Leave.find({
    employee: employee._id,
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
    throw new Error('Employee already has a leave request overlapping these dates');
  }

  // Deduct balance immediately
  const balance = { ...employee.leaveBalance };
  balance[leaveType] = Math.max(0, balance[leaveType] - totalDays);
  employee.leaveBalance = balance;
  employee.markModified('leaveBalance');
  await employee.save();

  // Create approved leave
  const leave = await Leave.create({
    employee: employee._id,
    leaveType,
    startDate: start,
    endDate: end,
    totalDays,
    reason,
    status: 'approved',
    actionedBy: req.user._id,
    actionedAt: new Date(),
    adminComment: 'Applied by Admin on behalf of Employee',
    isHalfDay: isHalfDayBool,
    halfDaySession: isHalfDayBool ? halfDaySession : '',
  });

  // Notify Employee
  await Notification.create({
    recipient: employee._id,
    title: 'Leave Approved',
    message: `A ${leaveType} leave request of ${totalDays} day(s) has been logged and approved on your behalf by Admin.`,
    type: 'success',
  });

  sendLeaveStatusEmail({ employee, leave }).catch(() => {});

  res.status(201).json(leave);
});

