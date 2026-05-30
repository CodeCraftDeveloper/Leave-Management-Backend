import asyncHandler from 'express-async-handler';
import ExcelJS from 'exceljs';
import Leave from '../models/Leave.js';
import Employee from '../models/Employee.js';
import Notification from '../models/Notification.js';
import Holiday from '../models/Holiday.js';
import { calculateDays, datesOverlap } from '../utils/calculateDays.js';
import { assessDepartmentStaffing } from '../utils/staffingCoverage.js';
import { isBeforeTodayIST } from '../utils/dateHelpers.js';
import { sendLeaveStatusEmail } from '../services/emailService.js';
import { onLeaveApproved } from '../services/leaveLifecycleService.js';
import { leaveTypeLabel } from '../utils/leaveTypes.js';
import { resolveHeadScope, intersectWithScope, scopeAllowsDepartment } from '../utils/headScope.js';
import { normalizeDepartmentName } from '../utils/constants.js';

// Guard: a scoped head may only act on employees inside their department(s).
// The super admin (scope.isSuper) always passes.
const assertDepartmentInScope = (scope, departmentName, res) => {
  if (!scopeAllowsDepartment(scope, departmentName)) {
    res.status(403);
    throw new Error('This employee is outside your department scope');
  }
};

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

const normalizeEmployeeInput = (payload, { requirePassword = false } = {}) => {
  const employeeId = typeof payload.employeeId === 'string' ? payload.employeeId.trim().toUpperCase() : '';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';
  const department = normalizeDepartmentName(payload.department);
  const designation = typeof payload.designation === 'string' ? payload.designation.trim() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  const joiningDate = payload.joiningDate ? new Date(payload.joiningDate) : undefined;

  if (!employeeId || !name || !email || !department || !designation) {
    throw new Error('Employee ID, name, email, department and designation are required');
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
  // Heads are department-scoped; the super admin sees the whole organisation.
  const scope = await resolveHeadScope(req.user);
  const employeeScope = scope.isSuper ? {} : { employee: { $in: scope.employeeIds } };
  const headcountScope = scope.isSuper ? {} : { department: { $in: scope.departmentNames } };

  const [totalEmployees, pending, approved, rejected] = await Promise.all([
    Employee.countDocuments({ role: { $in: ['employee', 'dept_head'] }, active: true, ...headcountScope }),
    Leave.countDocuments({ status: 'pending', ...employeeScope }),
    Leave.countDocuments({ status: 'approved', ...employeeScope }),
    Leave.countDocuments({ status: 'rejected', ...employeeScope }),
  ]);

  // Monthly analytics for current year
  const year = new Date().getFullYear();
  const monthly = await Leave.aggregate([
    {
      $match: {
        createdAt: { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31`) },
        ...employeeScope,
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

  const recent = await Leave.find(employeeScope)
    .sort({ createdAt: -1 })
    .limit(8)
    .populate('employee', 'name employeeId department');

  res.json({
    scope: {
      isSuperAdmin: scope.isSuper,
      departments: scope.isSuper ? [] : scope.departmentNames,
    },
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

  // Department scope for the calling head (super admin = unrestricted).
  const scope = await resolveHeadScope(req.user);

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
    filter.employee = { $in: intersectWithScope(scope, employees.map((e) => e._id)) };
  } else if (!scope.isSuper) {
    filter.employee = { $in: scope.employeeIds };
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

// @desc Export employee leaves to Excel
// @route GET /api/admin/leaves/export
export const exportLeaves = asyncHandler(async (req, res) => {
  const { status, type, search, startDate, endDate } = req.query;
  const filter = {};
  if (status && status !== 'all') filter.status = status;
  if (type && type !== 'all') filter.leaveType = type;
  if (startDate || endDate) {
    filter.startDate = {};
    if (startDate) filter.startDate.$gte = new Date(startDate);
    if (endDate) filter.startDate.$lte = new Date(endDate);
  }

  const scope = await resolveHeadScope(req.user);
  if (search) {
    const employees = await Employee.find({
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
      ],
    }).select('_id');
    filter.employee = { $in: intersectWithScope(scope, employees.map((e) => e._id)) };
  } else if (!scope.isSuper) {
    filter.employee = { $in: scope.employeeIds };
  }

  const leaves = await Leave.find(filter)
    .sort({ createdAt: -1 })
    .populate('employee', 'name employeeId department designation email')
    .populate('actionedBy', 'name employeeId');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Leave Management System';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Employee Leaves');

  sheet.columns = [
    { header: 'Employee ID', key: 'employeeId', width: 14 },
    { header: 'Employee Name', key: 'name', width: 24 },
    { header: 'Department', key: 'department', width: 18 },
    { header: 'Designation', key: 'designation', width: 18 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Leave Type', key: 'leaveType', width: 14 },
    { header: 'Start Date', key: 'startDate', width: 14 },
    { header: 'End Date', key: 'endDate', width: 14 },
    { header: 'Total Days', key: 'totalDays', width: 11 },
    { header: 'Half Day', key: 'halfDay', width: 12 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Reason', key: 'reason', width: 32 },
    { header: 'Reviewer Comment', key: 'adminComment', width: 32 },
    { header: 'Actioned By', key: 'actionedBy', width: 22 },
    { header: 'Actioned At', key: 'actionedAt', width: 18 },
    { header: 'Applied At', key: 'createdAt', width: 18 },
  ];

  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F2937' },
  };
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 22;

  const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  const fmtDT = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : '');

  leaves.forEach((l) => {
    sheet.addRow({
      employeeId: l.employee?.employeeId || '',
      name: l.employee?.name || '',
      department: l.employee?.department || '',
      designation: l.employee?.designation || '',
      email: l.employee?.email || '',
      leaveType: l.leaveType,
      startDate: fmt(l.startDate),
      endDate: fmt(l.endDate),
      totalDays: l.totalDays,
      halfDay: l.isHalfDay ? l.halfDaySession || 'yes' : '',
      status: l.status,
      reason: l.reason || '',
      adminComment: l.adminComment || '',
      actionedBy: l.actionedBy ? `${l.actionedBy.name} (${l.actionedBy.employeeId})` : '',
      actionedAt: fmtDT(l.actionedAt),
      createdAt: fmtDT(l.createdAt),
    });
  });

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columns.length },
  };

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="employee-leaves-${stamp}.xlsx"`
  );
  await workbook.xlsx.write(res);
  res.end();
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
  // Heads can only action leaves of employees in their department(s).
  const scope = await resolveHeadScope(req.user);
  assertDepartmentInScope(scope, leave.employee?.department, res);
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
    message: `Your ${leaveTypeLabel(leave.leaveType)} has been ${status}.${adminComment ? ' Note: ' + adminComment : ''}`,
    type: status === 'approved' ? 'success' : 'error',
  });

  await sendLeaveStatusEmail({ employee: leave.employee, leave });

  res.json(leave);
});

// @desc Get all employees
// @route GET /api/admin/employees
export const getEmployees = asyncHandler(async (req, res) => {
  const { search, department, page = 1, limit = 20 } = req.query;
  const filter = { role: { $in: ['employee', 'dept_head'] }, active: true };
  // Heads only see employees in their mapped department(s).
  const scope = await resolveHeadScope(req.user);
  if (!scope.isSuper) {
    filter.department = department && scope.departmentNames.includes(department)
      ? department
      : { $in: scope.departmentNames };
  } else if (department) {
    filter.department = department;
  }
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

  // A scoped head can only create employees inside their own department(s).
  const scope = await resolveHeadScope(req.user);
  assertDepartmentInScope(scope, input.department, res);

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
  const employee = await Employee.findOne({
    _id: req.params.id,
    role: { $in: ['employee', 'dept_head'] },
    active: true,
  });
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }
  const scope = await resolveHeadScope(req.user);
  assertDepartmentInScope(scope, employee.department, res);
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

  const employee = await Employee.findOne({
    _id: req.params.id,
    role: { $in: ['employee', 'dept_head'] },
    active: true,
  });
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }

  // Scoped heads can only edit employees in their department(s), and cannot
  // move them out to a department they don't manage.
  const scope = await resolveHeadScope(req.user);
  assertDepartmentInScope(scope, employee.department, res);
  assertDepartmentInScope(scope, input.department, res);

  try {
    await assertUniqueEmployeeIdentity(input, employee._id);
  } catch (error) {
    res.status(error.statusCode || 400);
    throw error;
  }

  employee.employeeId = input.employeeId;
  employee.name = input.name;
  if (employee.email !== input.email) {
    employee.email = input.email;
    employee.emailVerified = false;
    employee.emailVerifyCode = undefined;
    employee.emailVerifyExpires = undefined;
    employee.emailVerifyAttempts = 0;
  }
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
  const employee = await Employee.findOne({
    _id: req.params.id,
    role: { $in: ['employee', 'dept_head'] },
    active: true,
  });
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }

  const scope = await resolveHeadScope(req.user);
  assertDepartmentInScope(scope, employee.department, res);

  employee.active = false;
  await employee.save();

  res.json({ message: 'Employee deleted successfully' });
});

// @desc Update employee department/designation
// @route PATCH /api/admin/employees/:id/work-details
export const updateEmployeeWorkDetails = asyncHandler(async (req, res) => {
  const { department, designation } = req.body;
  const trimmedDepartment = normalizeDepartmentName(department);
  const trimmedDesignation = typeof designation === 'string' ? designation.trim() : '';

  if (!trimmedDepartment || !trimmedDesignation) {
    res.status(400);
    throw new Error('Department and designation are required');
  }

  const employee = await Employee.findOne({
    _id: req.params.id,
    role: { $in: ['employee', 'dept_head'] },
    active: true,
  });
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }

  // Scoped heads can only move employees between departments they manage.
  const scope = await resolveHeadScope(req.user);
  assertDepartmentInScope(scope, employee.department, res);
  assertDepartmentInScope(scope, trimmedDepartment, res);

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

  // Scoped heads can only log leave for employees in their department(s).
  const scope = await resolveHeadScope(req.user);
  assertDepartmentInScope(scope, employee.department, res);

  const isHalfDayBool = String(isHalfDay) === 'true';

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start) || isNaN(end)) {
    res.status(400);
    throw new Error('Invalid dates');
  }
  if (isBeforeTodayIST(start)) {
    res.status(400);
    throw new Error('Cannot apply leave for a past date');
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
    adminComment: 'Applied by Head on behalf of Employee',
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
    message: `A ${leaveTypeLabel(leaveType)} request of ${totalDays} day(s) has been logged and approved on your behalf by Head.`,
    type: 'success',
  });

  await sendLeaveStatusEmail({ employee, leave });

  res.status(201).json(leave);
});
