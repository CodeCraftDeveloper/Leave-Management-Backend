import asyncHandler from 'express-async-handler';
import Leave from '../models/Leave.js';
import Employee from '../models/Employee.js';
import Notification from '../models/Notification.js';
import Holiday from '../models/Holiday.js';
import { calculateDays, datesOverlap } from '../utils/calculateDays.js';
import { assessDepartmentStaffing } from '../utils/staffingCoverage.js';
import { sendLeaveStatusEmail } from '../services/emailService.js';
import { onLeaveApproved } from '../services/leaveLifecycleService.js';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

const normalizeEmployeeInput = (payload, { requirePassword = false } = {}) => {
  const employeeId = typeof payload.employeeId === 'string' ? payload.employeeId.trim().toUpperCase() : '';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';
  const department = typeof payload.department === 'string' ? payload.department.trim() : '';
  const designation = typeof payload.designation === 'string' ? payload.designation.trim() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  const joiningDate = payload.joiningDate ? new Date(payload.joiningDate) : undefined;

  if (!employeeId || !name || !department || !designation) {
    throw new Error('Employee ID, name, department and designation are required');
  }
  if (email && !EMAIL_PATTERN.test(email)) {
    throw new Error('A valid email is required');
  }
  if ((requirePassword || password) && password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }
  if (payload.joiningDate && Number.isNaN(joiningDate.getTime())) {
    throw new Error('A valid joining date is required');
  }

  return {
    employeeId,
    name,
    email: email || undefined,
    phone,
    department,
    designation,
    password,
    joiningDate,
  };
};

const assertUniqueEmployeeIdentity = async ({ employeeId, email }, excludeId) => {
  const matches = [{ employeeId }];
  if (email) matches.push({ email });
  const query = { $or: matches };
  if (excludeId) query._id = { $ne: excludeId };

  if (await Employee.exists(query)) {
    const error = new Error('Employee ID or email already exists');
    error.statusCode = 409;
    throw error;
  }
};

const throwEmployeeSaveError = (error, res) => {
  if (error?.code === 11000) {
    res.status(409);
    throw new Error('Employee ID or email already exists');
  }
  throw error;
};

const staffingOverrideInput = (payload) => ({
  requested: payload.overrideStaffingLimit === true || String(payload.overrideStaffingLimit) === 'true',
  reason: typeof payload.staffingOverrideReason === 'string' ? payload.staffingOverrideReason.trim() : '',
});

const rejectStaffingLimit = (res, staffingCoverage) => res.status(409).json({
  code: 'STAFFING_COVERAGE_LIMIT',
  message: `Approving this leave would leave fewer than ${staffingCoverage.minimumOnDuty} employee(s) available in ${staffingCoverage.department}. Add an override reason to proceed.`,
  staffingCoverage,
});

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

  let staffingCoverage;
  let staffingOverride = { requested: false, reason: '' };
  if (status === 'approved') {
    staffingCoverage = await assessDepartmentStaffing({
      employee: leave.employee,
      startDate: leave.startDate,
      endDate: leave.endDate,
      isHalfDay: leave.isHalfDay,
      halfDaySession: leave.halfDaySession,
      excludeLeaveId: leave._id,
    });
    staffingOverride = staffingOverrideInput(req.body);
    if (staffingCoverage.blocked && !staffingOverride.requested) {
      return rejectStaffingLimit(res, staffingCoverage);
    }
    if (staffingCoverage.blocked && !staffingOverride.reason) {
      res.status(400);
      throw new Error('A staffing override reason is required to approve this leave');
    }
  }

  leave.status = status;
  leave.adminComment = adminComment || '';
  leave.actionedBy = req.user._id;
  leave.actionedAt = new Date();
  leave.staffingOverride = status === 'approved' && staffingCoverage?.blocked && staffingOverride.requested;
  leave.staffingOverrideReason = leave.staffingOverride ? staffingOverride.reason : '';
  leave.staffingSnapshot = status === 'approved' ? staffingCoverage : undefined;
  await leave.save();

  // On approval: deduct balance + stamp ON_LEAVE attendance rows.
  if (status === 'approved') {
    try {
      await onLeaveApproved(leave, req.user._id);
    } catch (err) {
      console.error('Leave lifecycle hook failed:', err.message);
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
  const filter = { role: 'employee', active: true };
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

// @desc Add employee
// @route POST /api/admin/employees
export const createEmployee = asyncHandler(async (req, res) => {
  let input;
  try {
    input = normalizeEmployeeInput(req.body, { requirePassword: true });
  } catch (error) {
    res.status(400);
    throw error;
  }

  try {
    await assertUniqueEmployeeIdentity(input);
  } catch (error) {
    res.status(error.statusCode || 400);
    throw error;
  }

  let created;
  try {
    created = await Employee.create({
      ...input,
      role: 'employee',
    });
  } catch (error) {
    throwEmployeeSaveError(error, res);
  }
  const employee = await Employee.findById(created._id);
  res.status(201).json(employee);
});

// @desc Employee detail with leaves
// @route GET /api/admin/employees/:id
export const getEmployeeDetail = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({ _id: req.params.id, role: 'employee', active: true });
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }
  const leaves = await Leave.find({ employee: employee._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ employee, leaves });
});

// @desc Update employee profile and employment details
// @route PATCH /api/admin/employees/:id
export const updateEmployee = asyncHandler(async (req, res) => {
  if (Object.prototype.hasOwnProperty.call(req.body, 'password')) {
    res.status(403);
    throw new Error('Password can only be changed by the employee from their profile');
  }

  let input;
  try {
    input = normalizeEmployeeInput(req.body);
  } catch (error) {
    res.status(400);
    throw error;
  }

  const employee = await Employee.findOne({ _id: req.params.id, role: 'employee', active: true });
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }

  try {
    await assertUniqueEmployeeIdentity(input, employee._id);
  } catch (error) {
    res.status(error.statusCode || 400);
    throw error;
  }

  employee.employeeId = input.employeeId;
  employee.name = input.name;
  employee.email = input.email;
  employee.phone = input.phone;
  employee.department = input.department;
  employee.designation = input.designation;
  if (input.joiningDate) employee.joiningDate = input.joiningDate;
  try {
    await employee.save();
  } catch (error) {
    throwEmployeeSaveError(error, res);
  }

  res.json(await Employee.findById(employee._id));
});

// @desc Deactivate employee while preserving leave history
// @route DELETE /api/admin/employees/:id
export const deleteEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({ _id: req.params.id, role: 'employee', active: true });
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }

  employee.active = false;
  await employee.save();

  res.json({ message: 'Employee deleted successfully' });
});

// @desc Update employee department/designation
// @route PATCH /api/admin/employees/:id/work-details
export const updateEmployeeWorkDetails = asyncHandler(async (req, res) => {
  const { department, designation } = req.body;
  const trimmedDepartment = typeof department === 'string' ? department.trim() : '';
  const trimmedDesignation = typeof designation === 'string' ? designation.trim() : '';

  if (!trimmedDepartment || !trimmedDesignation) {
    res.status(400);
    throw new Error('Department and designation are required');
  }

  const employee = await Employee.findOne({ _id: req.params.id, role: 'employee', active: true });
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }

  employee.department = trimmedDepartment;
  employee.designation = trimmedDesignation;
  await employee.save();

  res.json(employee);
});

// @desc Apply leave on behalf of employee (Auto-approved)
// @route POST /api/admin/leaves
export const applyLeaveOnBehalf = asyncHandler(async (req, res) => {
  const { employeeId, leaveType, startDate, endDate, reason, isHalfDay, halfDaySession } = req.body;

  if (!employeeId || !leaveType || !startDate || !endDate || !reason) {
    res.status(400);
    throw new Error('All fields are required');
  }

  const employee = await Employee.findOne({ _id: employeeId, role: 'employee', active: true });
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

  const staffingCoverage = await assessDepartmentStaffing({
    employee,
    startDate: start,
    endDate: end,
    isHalfDay: isHalfDayBool,
    halfDaySession: isHalfDayBool ? halfDaySession : '',
  });
  const staffingOverride = staffingOverrideInput(req.body);
  if (staffingCoverage.blocked && !staffingOverride.requested) {
    return rejectStaffingLimit(res, staffingCoverage);
  }
  if (staffingCoverage.blocked && !staffingOverride.reason) {
    res.status(400);
    throw new Error('A staffing override reason is required to approve this leave');
  }

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
    staffingOverride: staffingCoverage.blocked && staffingOverride.requested,
    staffingOverrideReason: staffingCoverage.blocked && staffingOverride.requested ? staffingOverride.reason : '',
    staffingSnapshot: staffingCoverage,
    isHalfDay: isHalfDayBool,
    halfDaySession: isHalfDayBool ? halfDaySession : '',
  });

  // Auto-approved: deduct balance + stamp ON_LEAVE attendance.
  try {
    leave.employee = employee; // populate for the lifecycle helper
    await onLeaveApproved(leave, req.user._id);
  } catch (err) {
    console.error('Leave lifecycle hook failed:', err.message);
  }

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
