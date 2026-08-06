import crypto from 'crypto';
import asyncHandler from 'express-async-handler';
import ExcelJS from 'exceljs';
import Leave from '../models/Leave.js';
import Employee from '../models/Employee.js';
import Department from '../models/Department.js';
import Notification from '../models/Notification.js';
import Holiday from '../models/Holiday.js';
import { calculateDays, datesOverlap } from '../utils/calculateDays.js';
import { assessDepartmentStaffing } from '../utils/staffingCoverage.js';
import { isBeforeTodayIST } from '../utils/dateHelpers.js';
import { sendLeaveStatusEmail } from '../services/emailService.js';
import { onLeaveApproved } from '../services/leaveLifecycleService.js';
import { leaveTypeLabel } from '../utils/leaveTypes.js';
import { resolveHeadScope, intersectWithScope, scopeAllowsDepartment } from '../utils/headScope.js';
import { normalizeDepartmentName, DEPARTMENT_NAMES, SUPERADMIN_EMAILS } from '../utils/constants.js';
import { normalizeEmailList, validateEmailFormat } from '../utils/emailValidation.js';
import { cascadeDeleteEmployee } from '../utils/cascadeDeleteEmployee.js';

const STAFF_ROLES = ['employee', 'dept_head'];
const SUPER_ADMIN_MANAGED_ROLES = ['employee', 'dept_head', 'head'];
const ASSIGNABLE_ROLES = ['employee', 'head'];

// Guard: legacy department screens still use department visibility, but leave
// approval itself must be employee-routed through headNotificationEmails.
const assertDepartmentInScope = (scope, departmentName, res) => {
  if (!scopeAllowsDepartment(scope, departmentName)) {
    res.status(403);
    throw new Error('This employee is outside your department scope');
  }
};

const assertEmployeeInScope = (scope, employeeId, res) => {
  if (!scope || scope.employeeIds === null) return;
  const allowed = new Set(scope.employeeIds.map(String));
  if (!allowed.has(String(employeeId))) {
    res.status(403);
    throw new Error('This employee is outside your approval scope');
  }
};

// Reporting heads = the Head accounts that receive and approve an employee's
// leave (matched against Employee.headNotificationEmails by headScope). Accept
// either an array or a comma-separated string. Returns { provided } so callers
// can tell "leave unchanged" apart from "clear all".
const parseReportingHeadEmails = (payload) => {
  if (!Object.prototype.hasOwnProperty.call(payload, 'headNotificationEmails')) {
    return { provided: false, emails: [] };
  }
  const emails = normalizeEmailList(payload.headNotificationEmails, {
    label: 'reporting head email',
  });
  return { provided: true, emails };
};

const normalizeEmployeeInput = (payload, { requirePassword = false } = {}) => {
  const employeeId = typeof payload.employeeId === 'string' ? payload.employeeId.trim().toUpperCase() : '';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const email = validateEmailFormat(payload.email, { required: false, label: 'email' });
  const phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';
  const department = normalizeDepartmentName(payload.department);
  const designation = typeof payload.designation === 'string' ? payload.designation.trim() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  const joiningDate = payload.joiningDate ? new Date(payload.joiningDate) : undefined;
  const role = typeof payload.role === 'string' ? payload.role.trim() : '';

  if (!employeeId || !name || !department) {
    throw new Error('Employee ID, name and department are required');
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
    // Optional — falls back to the schema default ('Employee') when left blank.
    designation: designation || undefined,
    password,
    joiningDate,
    role: ASSIGNABLE_ROLES.includes(role) ? role : undefined,
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
  // Heads are employee-scoped by Employee.headNotificationEmails; the super
  // admin sees the whole organisation.
  const scope = await resolveHeadScope(req.user);
  const employeeScope = scope.isSuper ? {} : { employee: { $in: scope.employeeIds } };
  const headcountScope = scope.isSuper ? {} : { _id: { $in: scope.employeeIds } };

  const [totalEmployees, pending, approved, rejected] = await Promise.all([
    Employee.countDocuments({ role: { $in: STAFF_ROLES }, active: true, ...headcountScope }),
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

  // Employee scope for the calling head (super admin = unrestricted).
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
  // Heads can only action leaves of employees routed to their approval email.
  const scope = await resolveHeadScope(req.user);
  assertEmployeeInScope(scope, leave.employee?._id, res);
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
  const { search, department, includeHeads, page = 1, limit = 20 } = req.query;
  // Heads only see employees routed to their approval email.
  const scope = await resolveHeadScope(req.user);
  const roles = scope.isSuper && String(includeHeads) === 'true'
    ? SUPER_ADMIN_MANAGED_ROLES
    : STAFF_ROLES;
  const filter = { role: { $in: roles }, active: true };
  if (!scope.isSuper) {
    filter._id = { $in: scope.employeeIds };
    if (department && scope.departmentNames.includes(department)) {
      filter.department = department;
    }
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

// @desc Export all employees to Excel
// @route GET /api/admin/employees/export
export const exportEmployees = asyncHandler(async (req, res) => {
  // Super admin exports the whole organisation (staff + Head accounts); a
  // scoped head only gets the employees routed to their approval email.
  const scope = await resolveHeadScope(req.user);
  const roles = scope.isSuper ? SUPER_ADMIN_MANAGED_ROLES : STAFF_ROLES;
  const filter = { role: { $in: roles } };
  if (!scope.isSuper) filter._id = { $in: scope.employeeIds };

  const { sort } = req.query;
  const employees = await Employee.find(filter).sort({ employeeId: String(sort).toLowerCase() === 'desc' ? -1 : 1 });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Leave Management System';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Employees');

  sheet.columns = [
    { header: 'Employee ID', key: 'employeeId', width: 14 },
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Department', key: 'department', width: 18 },
    { header: 'Designation', key: 'designation', width: 20 },
    { header: 'Role', key: 'role', width: 12 },
    { header: 'Email Verified', key: 'emailVerified', width: 16 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Joining Date', key: 'joiningDate', width: 14 },
    { header: 'Reporting Head Emails', key: 'headNotificationEmails', width: 40 },
  ];

  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F2937' },
  };
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 22;

  employees.forEach((employee) => {
    sheet.addRow({
      employeeId: employee.employeeId,
      name: employee.name,
      email: employee.email || '',
      phone: employee.phone || '',
      department: employee.department,
      designation: employee.designation || '',
      role: employee.role,
      emailVerified: employee.emailVerified ? 'Yes' : 'No',
      status: employee.status || (employee.active ? 'ACTIVE' : 'INACTIVE'),
      joiningDate: employee.joiningDate
        ? new Date(employee.joiningDate).toISOString().slice(0, 10)
        : '',
      headNotificationEmails: (employee.headNotificationEmails || []).join(', '),
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
  res.setHeader('Content-Disposition', `attachment; filename="employees-${stamp}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

// @desc Add employee
// @route POST /api/admin/employees
export const createEmployee = asyncHandler(async (req, res) => {
  let input;
  let reportingHeads;
  try {
    input = normalizeEmployeeInput(req.body, { requirePassword: true });
    reportingHeads = parseReportingHeadEmails(req.body);
  } catch (error) {
    res.status(400);
    throw error;
  }

  // A scoped head can only create employees inside their own department(s).
  const scope = await resolveHeadScope(req.user);
  const nextRole = input.role || 'employee';
  if (nextRole === 'head' && !scope.isSuper) {
    res.status(403);
    throw new Error('Only the super admin can create Head accounts');
  }
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
      role: nextRole,
      ...(reportingHeads.provided ? { headNotificationEmails: reportingHeads.emails } : {}),
    });
  } catch (error) {
    throwEmployeeSaveError(error, res);
  }
  const employee = await Employee.findById(created._id);
  res.status(201).json(employee);
});

// @desc List Head accounts that can be assigned as an employee's reporting head
//       for leave approval. Available to any head (the super admin included).
// @route GET /api/admin/heads
export const getApprovalHeads = asyncHandler(async (req, res) => {
  const heads = await Employee.find({ role: 'head', active: true })
    .select('_id name employeeId department email notificationEmail')
    .sort({ name: 1 })
    .lean();
  res.json({ items: heads });
});

// @desc Employee detail with leaves
// @route GET /api/admin/employees/:id
export const getEmployeeDetail = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({
    _id: req.params.id,
    role: { $in: STAFF_ROLES },
    active: true,
  });
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }
  const scope = await resolveHeadScope(req.user);
  assertEmployeeInScope(scope, employee._id, res);
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
  let reportingHeads;
  try {
    input = normalizeEmployeeInput(req.body);
    reportingHeads = parseReportingHeadEmails(req.body);
  } catch (error) {
    res.status(400);
    throw error;
  }

  const scope = await resolveHeadScope(req.user);
  if (input.role === 'head' && !scope.isSuper) {
    res.status(403);
    throw new Error('Only the super admin can create or edit Head accounts');
  }
  const managedRoles = scope.isSuper ? SUPER_ADMIN_MANAGED_ROLES : STAFF_ROLES;
  const employee = await Employee.findOne({
    _id: req.params.id,
    role: { $in: managedRoles },
    active: true,
  });
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }
  if (input.role && String(employee._id) === String(req.user._id) && input.role !== employee.role) {
    res.status(400);
    throw new Error('You cannot change your own role from this screen');
  }

  // Scoped heads can only edit employees routed to their approval email, and
  // cannot move them out to a department they don't manage.
  assertEmployeeInScope(scope, employee._id, res);
  assertDepartmentInScope(scope, input.department, res);

  try {
    await assertUniqueEmployeeIdentity(input, employee._id);
  } catch (error) {
    res.status(error.statusCode || 400);
    throw error;
  }

  const previousRole = employee.role;
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
  employee.role = scope.isSuper && input.role ? input.role : employee.role;
  if (input.joiningDate) employee.joiningDate = input.joiningDate;
  // Reporting heads drive leave-approval routing. Only overwrite when the
  // caller explicitly sent the field so unrelated edits don't clear it.
  if (reportingHeads.provided) employee.headNotificationEmails = reportingHeads.emails;
  try {
    await employee.save();
  } catch (error) {
    throwEmployeeSaveError(error, res);
  }

  if (previousRole === 'dept_head' || (previousRole === 'head' && employee.role !== 'head')) {
    await Department.updateMany({ heads: employee._id }, { $pull: { heads: employee._id } });
  }

  res.json(await Employee.findById(employee._id));
});

// @desc Permanently delete an employee and every record tied to them
// @route DELETE /api/admin/employees/:id
export const deleteEmployee = asyncHandler(async (req, res) => {
  const scope = await resolveHeadScope(req.user);
  const managedRoles = scope.isSuper ? SUPER_ADMIN_MANAGED_ROLES : STAFF_ROLES;
  // No `active` filter — a hard delete should also clear out any record that was
  // previously soft-deleted (active: false) so the employee ID is fully freed.
  const employee = await Employee.findOne({
    _id: req.params.id,
    role: { $in: managedRoles },
  });
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }
  if (String(employee._id) === String(req.user._id)) {
    res.status(400);
    throw new Error('You cannot remove your own account from this screen');
  }

  assertEmployeeInScope(scope, employee._id, res);

  // Hard delete: removes the employee and all of their leave, attendance,
  // payroll, salary and notification records, and unlinks them everywhere.
  const deleted = await cascadeDeleteEmployee(employee);

  res.json({ message: 'Employee and all associated records permanently deleted', deleted });
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
    role: { $in: STAFF_ROLES },
    active: true,
  });
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }

  // Scoped heads can only move employees routed to their approval email.
  const scope = await resolveHeadScope(req.user);
  assertEmployeeInScope(scope, employee._id, res);
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

  const employee = await Employee.findOne({ _id: employeeId, role: { $in: STAFF_ROLES }, active: true });
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }

  // Scoped heads can only log leave for employees routed to their approval
  // email.
  const scope = await resolveHeadScope(req.user);
  assertEmployeeInScope(scope, employee._id, res);

  const isHalfDayBool = String(isHalfDay) === 'true';

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start) || isNaN(end)) {
    res.status(400);
    throw new Error('Invalid dates');
  }
  // The super admin may backfill leaves that already happened (past dates);
  // scoped heads can only log leave from today onward.
  const isBackfill = scope.isSuper && isBeforeTodayIST(start);
  if (isBeforeTodayIST(start) && !scope.isSuper) {
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
    const workingDaysCount = calculateDays(start, end, holidays, { employee });
    if (workingDaysCount === 0) {
      res.status(400);
      throw new Error('Cannot apply for half-day leave on a weekly off day');
    }
    totalDays = 0.5;
  } else {
    totalDays = calculateDays(start, end, holidays, { employee });
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

  // Staffing coverage is a forward-looking guard (keep N on duty). For a past
  // backfill the day has already passed, so the check is skipped entirely.
  let staffingCoverage;
  const staffingOverride = staffingOverrideInput(req.body);
  if (!isBackfill) {
    staffingCoverage = await assessDepartmentStaffing({
      employee,
      startDate: start,
      endDate: end,
      isHalfDay: isHalfDayBool,
      halfDaySession: isHalfDayBool ? halfDaySession : '',
    });
    if (staffingCoverage.blocked && !staffingOverride.requested) {
      return rejectStaffingLimit(res, staffingCoverage);
    }
    if (staffingCoverage.blocked && !staffingOverride.reason) {
      res.status(400);
      throw new Error('A staffing override reason is required to approve this leave');
    }
  }

  const staffingBlocked = Boolean(staffingCoverage?.blocked);

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
    adminComment: isBackfill
      ? 'Backfilled by Super Admin on behalf of Employee'
      : 'Applied by Head on behalf of Employee',
    staffingOverride: staffingBlocked && staffingOverride.requested,
    staffingOverrideReason: staffingBlocked && staffingOverride.requested ? staffingOverride.reason : '',
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
    message: isBackfill
      ? `A past ${leaveTypeLabel(leaveType)} of ${totalDays} day(s) has been recorded and approved on your behalf.`
      : `A ${leaveTypeLabel(leaveType)} request of ${totalDays} day(s) has been logged and approved on your behalf by Head.`,
    type: 'success',
  });

  await sendLeaveStatusEmail({ employee, leave });

  res.status(201).json(leave);
});

// ---------------------------------------------------------------------------
// Bulk employee import (Excel)
// ---------------------------------------------------------------------------

// Single source of truth for the import: drives the downloadable template, the
// in-workbook Instructions tab, and the header-matching used while parsing.
// `aliases` are additional header spellings accepted on upload (normalized).
const IMPORT_COLUMNS = [
  {
    key: 'employeeId', header: 'Employee ID', required: true, width: 16, example: 'EMP1001',
    description: 'Unique staff ID. Automatically uppercased. Must not already exist.',
    aliases: ['empid', 'id', 'staffid', 'employeecode', 'code'],
  },
  {
    key: 'name', header: 'Name', required: true, width: 24, example: 'Asha Menon',
    description: 'Full name of the employee.',
    aliases: ['fullname', 'employeename'],
  },
  {
    key: 'email', header: 'Email', required: false, width: 30, example: 'asha.menon@premindustries.in',
    description: 'Login email. Optional, but must be unique when provided.',
    aliases: ['emailid', 'emailaddress', 'mail'],
  },
  {
    key: 'phone', header: 'Phone', required: false, width: 16, example: '9876543210',
    description: 'Contact number.',
    aliases: ['mobile', 'phonenumber', 'contact', 'mobileno', 'contactnumber'],
  },
  {
    key: 'department', header: 'Department', required: true, width: 22, example: 'Accounts',
    description: 'Must match an existing department — see the Departments tab.',
    aliases: ['dept', 'departmentname'],
  },
  {
    key: 'designation', header: 'Designation', required: false, width: 20, example: 'Accountant',
    description: 'Job title. Defaults to "Employee" when left blank.',
    aliases: ['title', 'jobtitle'],
  },
  {
    key: 'password', header: 'Password', required: false, width: 16, example: 'Welcome@123',
    description: 'Initial password (min 6 chars). Auto-generated if blank — the generated value is shown in the import results.',
    aliases: ['initialpassword', 'temppassword'],
  },
  {
    key: 'joiningDate', header: 'Joining Date', required: false, width: 16, example: '2026-01-15',
    description: 'Date of joining in YYYY-MM-DD format.',
    aliases: ['doj', 'dateofjoining', 'joindate', 'joiningdate'],
  },
  {
    key: 'role', header: 'Role', required: false, width: 12, example: 'employee',
    description: 'employee or head. Only the super admin may create head accounts.',
    aliases: ['userrole', 'accountrole', 'accesslevel'],
  },
  {
    key: 'reportingHeadEmails', header: 'Reporting Head Emails', required: false, width: 34, example: 'head.accounts@premindustries.in',
    description: 'Comma-separated Head routing emails that approve this employee\'s leave — must match an account on the Heads tab. When a head imports and leaves this blank, the employee routes to that head automatically.',
    aliases: ['reportinghead', 'reportingheads', 'heademails', 'approveremails', 'approveremail', 'headnotificationemails', 'notificationemails'],
  },
];

// Active, non-super Head accounts are the valid reporting targets an employee's
// leave can route to (Employee.headNotificationEmails). Super admins approve
// globally and are never a departmental reporting head, mirroring the head UI.
// Returns the display list (canonical routing email each) plus the full set of
// addresses accepted on import (either the login or notification email matches).
const loadReportingHeads = async () => {
  const docs = await Employee.find({ role: 'head', active: true })
    .select('name employeeId email notificationEmail')
    .sort({ name: 1 })
    .lean();
  const heads = [];
  const validEmails = new Set();
  for (const doc of docs) {
    const routing = String(doc.notificationEmail || doc.email || '').toLowerCase();
    if (!routing || SUPERADMIN_EMAILS.includes(routing)) continue;
    heads.push({ name: doc.name, employeeId: doc.employeeId, email: routing });
    for (const value of [doc.email, doc.notificationEmail]) {
      const email = String(value || '').toLowerCase();
      if (email && !SUPERADMIN_EMAILS.includes(email)) validEmails.add(email);
    }
  }
  return { heads, validEmails };
};

// Rows imported in a single upload. Guards against a runaway/oversized sheet.
const MAX_IMPORT_ROWS = 1000;

// Post-parse bounds. A small compressed .xlsx can decompress into a very large
// workbook (zip-bomb style), so reject anything with an implausible shape for an
// employee roster before we iterate it.
const MAX_WORKSHEETS = 12;
const MAX_SHEET_ROWS = 20000;
const PARSE_TIMEOUT_MS = 15000;

// .xlsx is a ZIP archive — every valid file starts with the "PK" signature.
// Verifies the actual bytes rather than trusting the extension/MIME the client
// sent (a renamed .exe would pass those but fail here).
const looksLikeXlsx = (buffer) =>
  Buffer.isBuffer(buffer) && buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;

// Load with a wall-clock ceiling so a pathological workbook can't tie up the
// request indefinitely. Rejects (caught by the caller) on parse error/timeout,
// which also covers encrypted/password-protected workbooks ExcelJS can't open.
const loadWorkbookWithTimeout = async (buffer) => {
  const workbook = new ExcelJS.Workbook();
  await Promise.race([
    workbook.xlsx.load(buffer),
    new Promise((_, reject) => setTimeout(() => reject(new Error('parse-timeout')), PARSE_TIMEOUT_MS)),
  ]);
  return workbook;
};

const normalizeHeader = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// normalized header text -> canonical column key
const IMPORT_HEADER_LOOKUP = (() => {
  const lookup = new Map();
  for (const column of IMPORT_COLUMNS) {
    lookup.set(normalizeHeader(column.header), column.key);
    for (const alias of column.aliases || []) lookup.set(normalizeHeader(alias), column.key);
  }
  return lookup;
})();

// ExcelJS cell values may be plain strings/numbers, Date objects, hyperlink or
// rich-text objects, or formula results. Flatten any of them to trimmed text.
const cellToString = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('').trim();
    if (value.text !== undefined) return String(value.text).trim();
    if (value.result !== undefined) return String(value.result).trim();
    if (value.hyperlink !== undefined) return String(value.hyperlink).trim();
    return '';
  }
  return String(value).trim();
};

// Initial credential for rows that leave Password blank. Includes a letter, a
// symbol and hex digits so it clears the 6-char minimum with some complexity.
const generateInitialPassword = () => `Emp@${crypto.randomBytes(4).toString('hex')}`;

// @desc Download the bulk-import Excel template (with instructions + dropdowns)
// @route GET /api/admin/employees/import/template
export const downloadImportTemplate = asyncHandler(async (req, res) => {
  // Always ship the full list of valid department names so the reference tab and
  // dropdown are populated for everyone (a scoped head's own department set can
  // be empty). The server still enforces per-row department scope on import, so
  // a scoped head picking a department they don't manage gets a clear error.
  const departmentOptions = [...DEPARTMENT_NAMES];
  const { heads: reportingHeads } = await loadReportingHeads();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Leave Management System';
  workbook.created = new Date();

  // 1) Employees — the sheet the admin fills in.
  const sheet = workbook.addWorksheet('Employees', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = IMPORT_COLUMNS.map((column) => ({ header: column.header, key: column.key, width: column.width }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 22;

  // Two clearly-marked example rows the admin should delete before importing.
  const sampleDepartment = departmentOptions[0] || 'Accounts';
  sheet.addRow({
    employeeId: 'EMP1001', name: 'Asha Menon', email: 'asha.menon@premindustries.in',
    phone: '9876543210', department: sampleDepartment, designation: 'Accountant',
    password: '', joiningDate: '2026-01-15', role: 'employee', reportingHeadEmails: '',
  });
  sheet.addRow({
    employeeId: 'EMP1002', name: 'Ravi Kumar', email: '', phone: '9876500000',
    department: sampleDepartment, designation: '', password: '', joiningDate: '',
    role: 'employee', reportingHeadEmails: '',
  });
  [2, 3].forEach((rowNumber) => {
    sheet.getRow(rowNumber).font = { italic: true, color: { argb: 'FF9CA3AF' } };
  });

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: IMPORT_COLUMNS.length } };

  // 2) Departments — reference list + source range for the Department dropdown.
  const deptSheet = workbook.addWorksheet('Departments');
  deptSheet.getColumn(1).width = 32;
  deptSheet.getCell('A1').value = 'Valid Department Names';
  deptSheet.getCell('A1').font = { bold: true };
  departmentOptions.forEach((name, index) => {
    deptSheet.getCell(`A${index + 2}`).value = name;
  });

  // In-cell dropdowns on the fill-in sheet for the first 500 data rows.
  const deptColLetter = sheet.getColumn('department').letter;
  const roleColLetter = sheet.getColumn('role').letter;
  const lastDeptRow = departmentOptions.length + 1;
  for (let rowNumber = 2; rowNumber <= 501; rowNumber += 1) {
    if (departmentOptions.length) {
      sheet.getCell(`${deptColLetter}${rowNumber}`).dataValidation = {
        type: 'list', allowBlank: false, formulae: [`Departments!$A$2:$A$${lastDeptRow}`],
        showErrorMessage: true, errorTitle: 'Unknown department',
        error: 'Pick a department from the Departments tab.',
      };
    }
    sheet.getCell(`${roleColLetter}${rowNumber}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: ['"employee,head"'],
    };
  }

  // 3) Heads — reference list of the Head accounts that leave can be routed to.
  const headSheet = workbook.addWorksheet('Heads');
  headSheet.columns = [
    { header: 'Head Name', key: 'name', width: 26 },
    { header: 'Employee ID', key: 'employeeId', width: 16 },
    { header: 'Routing Email (paste into Reporting Head Emails)', key: 'email', width: 48 },
  ];
  const headHeader = headSheet.getRow(1);
  headHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  headHeader.alignment = { vertical: 'middle', horizontal: 'center' };
  if (reportingHeads.length) {
    reportingHeads.forEach((head) => headSheet.addRow(head));
  } else {
    headSheet.addRow({ name: 'No reporting Head accounts are configured yet.' });
  }

  // 4) Instructions — the per-column helper.
  const guide = workbook.addWorksheet('Instructions');
  guide.columns = [
    { header: 'Column', key: 'column', width: 22 },
    { header: 'Required', key: 'required', width: 12 },
    { header: 'Description', key: 'description', width: 62 },
    { header: 'Example', key: 'example', width: 32 },
  ];
  const guideHeader = guide.getRow(1);
  guideHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  guideHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  guideHeader.alignment = { vertical: 'middle', horizontal: 'center' };
  IMPORT_COLUMNS.forEach((column) => {
    guide.addRow({
      column: column.header,
      required: column.required ? 'Required' : 'Optional',
      description: column.description,
      example: column.example,
    });
  });
  guide.getColumn('description').alignment = { wrapText: true, vertical: 'top' };
  guide.addRow({});
  guide.addRow({
    column: 'Note',
    description: 'Delete the two grey example rows on the Employees tab before importing. Leave Password blank to auto-generate one — it appears in the import results so you can share it with the employee.',
  });
  guide.addRow({
    column: 'Reporting heads',
    description: 'Leave requests only reach a Head when the employee is routed to them. Put one or more Head routing emails (from the Heads tab) in Reporting Head Emails. If a head runs the import and leaves it blank, the employee is routed to that head automatically; a blank left by the super admin leaves the employee unassigned until a head is set.',
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="employee-import-template.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

// @desc Bulk-onboard employees from an uploaded .xlsx workbook
// @route POST /api/admin/employees/import
export const importEmployees = asyncHandler(async (req, res) => {
  if (!req.file || !req.file.buffer) {
    res.status(400);
    throw new Error('Please attach an .xlsx file to import');
  }

  // Verify the real file signature before handing the bytes to ExcelJS — the
  // extension/MIME the browser sent are not trustworthy on their own.
  if (!looksLikeXlsx(req.file.buffer)) {
    res.status(400);
    throw new Error('The uploaded file is not a valid .xlsx workbook');
  }

  let workbook;
  try {
    workbook = await loadWorkbookWithTimeout(req.file.buffer);
  } catch {
    res.status(400);
    throw new Error('The file could not be read. It may be corrupt, encrypted or password-protected.');
  }

  // Reject workbooks whose shape is implausible for an employee roster (guards
  // against decompression-bomb style files) before iterating any rows.
  if (workbook.worksheets.length > MAX_WORKSHEETS) {
    res.status(400);
    throw new Error('This workbook has too many sheets to import');
  }

  const sheet =
    workbook.getWorksheet('Employees') ||
    workbook.worksheets.find((ws) => ws.actualRowCount > 1) ||
    workbook.worksheets[0];
  if (!sheet) {
    res.status(400);
    throw new Error('The workbook has no worksheets');
  }
  if (sheet.rowCount > MAX_SHEET_ROWS) {
    res.status(400);
    throw new Error(`This sheet has too many rows. Import at most ${MAX_IMPORT_ROWS} employees at a time.`);
  }

  // Map the header row to canonical column keys.
  const columnIndex = {};
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const key = IMPORT_HEADER_LOOKUP.get(normalizeHeader(cellToString(cell.value)));
    if (key && !(key in columnIndex)) columnIndex[key] = colNumber;
  });

  const missingRequired = IMPORT_COLUMNS
    .filter((column) => column.required && !(column.key in columnIndex))
    .map((column) => column.header);
  if (missingRequired.length) {
    res.status(400);
    throw new Error(
      `The sheet is missing required column(s): ${missingRequired.join(', ')}. Download the template to see the expected headers.`
    );
  }

  const scope = await resolveHeadScope(req.user);

  // Reporting-head routing (Employee.headNotificationEmails) decides which Head
  // sees and approves an employee's leave. validHeadEmails lets us reject typos;
  // selfHeadEmail is the importing head's own routing address, used as the
  // default so a head's imported staff stay inside that head's scope.
  const { validEmails: validHeadEmails } = await loadReportingHeads();
  const selfHeadEmail = String(req.user.notificationEmail || req.user.email || '').toLowerCase();

  const results = [];
  const seenIds = new Set();
  const seenEmails = new Set();
  let createdCount = 0;
  let truncated = false;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const raw = {};
    let hasAnyValue = false;
    for (const [key, colNumber] of Object.entries(columnIndex)) {
      const text = cellToString(row.getCell(colNumber).value);
      raw[key] = text;
      if (text) hasAnyValue = true;
    }
    if (!hasAnyValue) continue; // skip fully blank rows

    if (results.length >= MAX_IMPORT_ROWS) {
      truncated = true;
      break;
    }

    const outcome = { row: rowNumber, employeeId: raw.employeeId || '', name: raw.name || '', status: 'error', message: '' };
    try {
      const payload = {
        employeeId: raw.employeeId,
        name: raw.name,
        email: raw.email,
        phone: raw.phone,
        department: raw.department,
        designation: raw.designation,
        password: raw.password,
        joiningDate: raw.joiningDate,
        role: raw.role,
        headNotificationEmails: raw.reportingHeadEmails,
      };

      const input = normalizeEmployeeInput(payload);
      const reportingHeads = parseReportingHeadEmails(payload);
      const nextRole = input.role || 'employee';

      if (nextRole === 'head' && !scope.isSuper) {
        throw new Error('Only the super admin can create Head accounts');
      }
      if (!scopeAllowsDepartment(scope, input.department)) {
        throw new Error('This department is outside your scope');
      }
      if (seenIds.has(input.employeeId)) {
        throw new Error('Duplicate Employee ID within the file');
      }
      if (input.email && seenEmails.has(input.email)) {
        throw new Error('Duplicate email within the file');
      }

      await assertUniqueEmployeeIdentity({ employeeId: input.employeeId, email: input.email });

      // Resolve reporting-head routing for this row.
      //   head row        -> heads are approvers, never routed
      //   emails given     -> validate each against a real Head account
      //   scoped head, blank -> route to the importing head (stay in scope)
      //   super admin, blank  -> leave unassigned (assign a head later)
      let headEmails;
      if (nextRole === 'head') {
        headEmails = undefined;
      } else if (reportingHeads.provided && reportingHeads.emails.length) {
        const unknown = reportingHeads.emails.filter((email) => !validHeadEmails.has(email));
        if (unknown.length) {
          throw new Error(`Unknown reporting head email(s): ${unknown.join(', ')}. Use an account from the Heads tab.`);
        }
        headEmails = reportingHeads.emails;
      } else if (!scope.isSuper && selfHeadEmail) {
        headEmails = [selfHeadEmail];
      } else {
        headEmails = [];
      }

      const passwordProvided = Boolean(input.password);
      const password = passwordProvided ? input.password : generateInitialPassword();

      const employee = await Employee.create({
        ...input,
        password,
        role: nextRole,
        ...(headEmails !== undefined ? { headNotificationEmails: headEmails } : {}),
      });

      seenIds.add(input.employeeId);
      if (input.email) seenEmails.add(input.email);
      createdCount += 1;

      const notes = [];
      if (!passwordProvided) notes.push('auto-generated password');
      if (nextRole !== 'head' && (!headEmails || headEmails.length === 0)) {
        notes.push('no reporting head assigned');
      }

      outcome.status = 'created';
      outcome.employeeId = employee.employeeId;
      outcome.name = employee.name;
      outcome.message = notes.length ? `Created — ${notes.join('; ')}` : 'Created';
      if (!passwordProvided) outcome.password = password;
    } catch (error) {
      outcome.status = 'error';
      outcome.message = error.message || 'Could not import this row';
    }
    results.push(outcome);
  }

  res.json({
    summary: {
      total: results.length,
      created: createdCount,
      failed: results.length - createdCount,
      truncated,
    },
    results,
  });
});
