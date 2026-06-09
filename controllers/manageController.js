import asyncHandler from 'express-async-handler';
import ExcelJS from 'exceljs';
import Leave from '../models/Leave.js';
import Employee from '../models/Employee.js';
import Notification from '../models/Notification.js';
import { assessDepartmentStaffing } from '../utils/staffingCoverage.js';
import {
  sendLeaveApprovedHeadNotice,
  sendLeaveStatusEmail,
  sendLeaveReversedEmail,
} from '../services/emailService.js';
import { onLeaveApproved, onApprovedLeaveCancelled } from '../services/leaveLifecycleService.js';
import { getApprovedLeavesForWeek, sendWeeklyHeadDigest } from '../services/weeklyDigestService.js';
import { leaveTypeLabel } from '../utils/leaveTypes.js';
import { isSuperAdmin, resolveHeadScope, scopeAllowsDepartment } from '../utils/headScope.js';
import { normalizeDepartmentName, SUPERADMIN_EMAILS } from '../utils/constants.js';
import { listPostApprovalNoticeHeadsForEmployee } from '../utils/approverResolver.js';
import { isBeforeTodayIST } from '../utils/dateHelpers.js';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const isPastLeave = (leave) => isBeforeTodayIST(leave?.endDate);

// Build the Mongo filter for leave rows that `req.user` is allowed to review.
// head:        employees whose row routes to the head's email.
// super admin: full organisation visibility.
const scopedLeaveFilter = async (user) => {
  if (user.role === 'head') {
    const scope = await resolveHeadScope(user);
    if (scope.isSuper) return {};
    return { employee: { $in: scope.employeeIds } };
  }
  // Anyone else - empty scope.
  return { _id: null };
};

const buildReviewQueueFilter = async (user, query = {}) => {
  const { status, type, search, startDate, endDate, period, month } = query;
  const baseFilter = await scopedLeaveFilter(user);
  const filter = { ...baseFilter };

  if (status && status !== 'all') filter.status = status;
  if (type && type !== 'all') filter.leaveType = type;
  if (period && period !== 'all') {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59, 999);

    if (period === 'past') {
      filter.endDate = { $lt: todayStart };
    } else if (period === 'present') {
      filter.startDate = { $lte: todayEnd };
      filter.endDate = { $gte: todayStart };
    } else if (period === 'future') {
      filter.startDate = { $gt: todayEnd };
    }
  }

  if (month) {
    const [year, monthIndex] = String(month).split('-').map(Number);
    if (year && monthIndex >= 1 && monthIndex <= 12) {
      const monthStart = new Date(year, monthIndex - 1, 1);
      const monthEnd = new Date(year, monthIndex, 0, 23, 59, 59, 999);
      filter.startDate = { ...(filter.startDate || {}), $lte: monthEnd };
      filter.endDate = { ...(filter.endDate || {}), $gte: monthStart };
    }
  } else if (startDate || endDate) {
    if (endDate) filter.startDate = { ...(filter.startDate || {}), $lte: new Date(endDate) };
    if (startDate) filter.endDate = { ...(filter.endDate || {}), $gte: new Date(startDate) };
  }

  if (search) {
    const employees = await Employee.find({
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ],
    }).select('_id');

    const matchingIds = employees.map((e) => e._id);
    const scopedIds = baseFilter.employee?.$in
      ? matchingIds.filter((id) => new Set(baseFilter.employee.$in.map(String)).has(String(id)))
      : matchingIds;
    filter.employee = { $in: scopedIds };
  }

  return filter;
};

// @desc Leave requests I can review (with status filter)
// @route GET /api/manage/leaves
export const getReviewQueue = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const filter = await buildReviewQueueFilter(req.user, req.query);

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    Leave.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('employee', 'name employeeId department email role')
      .populate('approver', 'name employeeId'),
    Leave.countDocuments(filter),
  ]);
  res.json({ items, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
});

// @desc Export leave requests I can review
// @route GET /api/manage/leaves/export
export const exportReviewQueue = asyncHandler(async (req, res) => {
  const filter = await buildReviewQueueFilter(req.user, req.query);
  const leaves = await Leave.find(filter)
    .sort({ createdAt: -1 })
    .populate('employee', 'name employeeId department designation email role')
    .populate('approver', 'name employeeId')
    .populate('actionedBy', 'name employeeId');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Prem Industries Leave Portal';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Review Queue');

  sheet.columns = [
    { header: 'Employee ID', key: 'employeeId', width: 14 },
    { header: 'Employee Name', key: 'name', width: 24 },
    { header: 'Role', key: 'role', width: 16 },
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
    { header: 'Assigned Approver', key: 'approver', width: 22 },
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

  leaves.forEach((leave) => {
    sheet.addRow({
      employeeId: leave.employee?.employeeId || '',
      name: leave.employee?.name || '',
      role: leave.employee?.role === 'head' ? 'Head' : 'Employee',
      department: leave.employee?.department || '',
      designation: leave.employee?.designation || '',
      email: leave.employee?.email || '',
      leaveType: leave.leaveType,
      startDate: fmt(leave.startDate),
      endDate: fmt(leave.endDate),
      totalDays: leave.totalDays,
      halfDay: leave.isHalfDay ? leave.halfDaySession || 'yes' : '',
      status: leave.status,
      reason: leave.reason || '',
      adminComment: leave.adminComment || '',
      approver: leave.approver ? `${leave.approver.name} (${leave.approver.employeeId})` : '',
      actionedBy: leave.actionedBy ? `${leave.actionedBy.name} (${leave.actionedBy.employeeId})` : '',
      actionedAt: fmtDT(leave.actionedAt),
      createdAt: fmtDT(leave.createdAt),
    });
  });

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columns.length },
  };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: 'top', wrapText: true };
  });

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="review-queue-${stamp}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

// @desc My team — employees I oversee
//   head -> employees routed to this head's approval email
// @route GET /api/manage/team
export const getTeam = asyncHandler(async (req, res) => {
  const { search, department, includeHeads } = req.query;

  let filter;
  if (req.user.role === 'head') {
    // Scoped heads only see employees routed to their approval email.
    const scope = await resolveHeadScope(req.user);
    const roles = scope.isSuper && String(includeHeads) === 'true'
      ? ['employee', 'dept_head', 'head']
      : ['employee', 'dept_head'];
    filter = { active: true, role: { $in: roles } };
    if (scope.isSuper && String(includeHeads) === 'true') {
      filter.$or = [
        { role: { $ne: 'head' } },
        { _id: req.user._id },
        {
          $and: [
            { email: { $nin: SUPERADMIN_EMAILS } },
            { notificationEmail: { $nin: SUPERADMIN_EMAILS } },
          ],
        },
      ];
    }
    if (!scope.isSuper) {
      filter._id = { $in: scope.employeeIds };
      if (department && scope.departmentNames.includes(department)) {
        filter.department = department;
      }
    } else if (department) {
      filter.department = department;
    }
  } else {
    res.status(403);
    throw new Error('Not authorized');
  }

  if (search) {
    const searchOr = [
      { name: { $regex: search, $options: 'i' } },
      { employeeId: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
    if (filter.$or) {
      filter.$and = [...(filter.$and || []), { $or: filter.$or }, { $or: searchOr }];
      delete filter.$or;
    } else {
      filter.$or = searchOr;
    }
  }

  const employees = await Employee.find(filter)
    .sort({ department: 1, role: -1, name: 1 })
    .select('-password -emailVerifyCode -emailVerifyExpires -emailVerifyAttempts');

  // Group by department for convenient rendering.
  const grouped = {};
  for (const emp of employees) {
    const key = emp.department || 'Unassigned';
    grouped[key] = grouped[key] || [];
    grouped[key].push(emp);
  }
  res.json({ items: employees, grouped });
});

const rejectStaffingLimit = (res, staffingCoverage) => res.status(409).json({
  code: 'STAFFING_COVERAGE_LIMIT',
  message: `Approving this leave would leave fewer than ${staffingCoverage.minimumOnDuty} employee(s) available in ${staffingCoverage.department}. Add an override reason to proceed.`,
  staffingCoverage,
});

// @desc Approve / reject a leave I'm allowed to review.
// @route PATCH /api/manage/leaves/:id
export const actionLeave = asyncHandler(async (req, res) => {
  const { status, adminComment, overrideStaffingLimit, staffingOverrideReason } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    res.status(400);
    throw new Error('Invalid status');
  }
  const leave = await Leave.findById(req.params.id).populate('employee');
  if (!leave) {
    res.status(404);
    throw new Error('Leave not found');
  }

  const scope = await resolveHeadScope(req.user);
  const canAction = scope.employeeIds === null || scope.employeeIds.map(String).includes(String(leave.employee?._id));
  if (!canAction) {
    res.status(403);
    throw new Error('You cannot action this leave');
  }

  if (leave.status !== 'pending') {
    res.status(400);
    throw new Error(`Leave already ${leave.status}`);
  }

  let staffingCoverage;
  let overrideRequested = overrideStaffingLimit === true || String(overrideStaffingLimit) === 'true';
  let overrideReason = typeof staffingOverrideReason === 'string' ? staffingOverrideReason.trim() : '';
  if (status === 'approved') {
    staffingCoverage = await assessDepartmentStaffing({
      employee: leave.employee,
      startDate: leave.startDate,
      endDate: leave.endDate,
      isHalfDay: leave.isHalfDay,
      halfDaySession: leave.halfDaySession,
      excludeLeaveId: leave._id,
    });
    if (staffingCoverage.blocked && !overrideRequested) {
      return rejectStaffingLimit(res, staffingCoverage);
    }
    if (staffingCoverage.blocked && !overrideReason) {
      res.status(400);
      throw new Error('A staffing override reason is required to approve this leave');
    }
  }

  leave.status = status;
  leave.adminComment = adminComment || '';
  leave.actionedBy = req.user._id;
  leave.actionedAt = new Date();
  leave.staffingOverride = status === 'approved' && staffingCoverage?.blocked && overrideRequested;
  leave.staffingOverrideReason = leave.staffingOverride ? overrideReason : '';
  leave.staffingSnapshot = status === 'approved' ? staffingCoverage : undefined;
  await leave.save();

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
    link: '/history',
  });
  await sendLeaveStatusEmail({ employee: leave.employee, leave });

  if (status === 'approved') {
    const noticeHeads = await listPostApprovalNoticeHeadsForEmployee(leave.employee, {
      excludeId: req.user._id,
    });
    const headNotifications = noticeHeads
      .filter((head) => head?._id)
      .map((head) => Notification.create({
        recipient: head._id,
        title: 'Leave Approved',
        message: `${req.user.name} approved ${leave.employee.name} (${leave.employee.employeeId}) leave.`,
        type: 'success',
        link: '/head/leaves?status=approved',
      }));
    await Promise.all(headNotifications);
    await sendLeaveApprovedHeadNotice({
      heads: noticeHeads,
      employee: leave.employee,
      leave,
      approvedBy: req.user,
    });
  }

  res.json(leave);
});

// @desc Cancel (overturn) a leave I'm allowed to review — used when a head
//       needs to reverse a previously approved leave. Cleans the attendance
//       stamps, records who actioned it, notifies the employee, and emails both
//       the employee and the original approver.
// @route PATCH /api/manage/leaves/:id/cancel
export const cancelLeave = asyncHandler(async (req, res) => {
  const adminComment = typeof req.body.adminComment === 'string' ? req.body.adminComment.trim() : '';

  const leave = await Leave.findById(req.params.id)
    .populate('employee')
    .populate('actionedBy', 'name email notificationEmail employeeId')
    .populate('approver', 'name email notificationEmail employeeId');
  if (!leave) {
    res.status(404);
    throw new Error('Leave not found');
  }

  const scope = await resolveHeadScope(req.user);
  const canAction = scope.employeeIds === null || scope.employeeIds.map(String).includes(String(leave.employee?._id));
  if (!canAction) {
    res.status(403);
    throw new Error('You cannot action this leave');
  }

  if (leave.status !== 'approved') {
    res.status(400);
    throw new Error(`Only approved leaves can be cancelled (this one is ${leave.status})`);
  }

  if (isPastLeave(leave)) {
    res.status(400);
    throw new Error('Past approved leaves cannot be cancelled by Heads');
  }

  // Remember the original approver before we overwrite the audit fields so the
  // reversal email can notify the person whose approval was overturned.
  const originalApprover = leave.actionedBy || leave.approver || null;

  leave.status = 'cancelled';
  leave.adminComment = adminComment;
  leave.actionedBy = req.user._id;
  leave.actionedAt = new Date();
  await leave.save();

  // Clear the ON_LEAVE / HALF_DAY attendance stamps created at approval time.
  try {
    await onApprovedLeaveCancelled(leave);
  } catch (err) {
    console.error('Leave cancellation cleanup failed:', err.message);
  }

  await Notification.create({
    recipient: leave.employee._id,
    title: 'Leave Cancelled',
    message: `Your previously approved ${leaveTypeLabel(leave.leaveType)} has been cancelled by ${req.user.name}.${adminComment ? ' Note: ' + adminComment : ''}`,
    type: 'error',
    link: '/history',
  });

  await sendLeaveReversedEmail({
    employee: leave.employee,
    originalApprover,
    leave,
    reversedBy: req.user,
  });

  res.json(leave);
});

// @desc Create a new employee in the global database and assign their
//       department. Heads can only create into a department they oversee; the
//       super admin can target any department.
// @route POST /api/manage/employees
export const createEmployee = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const employeeId = String(req.body.employeeId || '').trim().toUpperCase();
  const email = normalizeEmail(req.body.email);
  const phone = String(req.body.phone || '').trim();
  const designation = String(req.body.designation || '').trim() || 'Employee';
  const department = normalizeDepartmentName(req.body.department) || String(req.body.department || '').trim();
  const password = String(req.body.password || '').trim() || 'changeme123';

  if (!name || !employeeId) {
    res.status(400);
    throw new Error('Name and employee ID are required');
  }
  if (!department) {
    res.status(400);
    throw new Error('A department is required');
  }
  if (password.length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters');
  }

  // Scoped heads may only create staff inside the department(s) they oversee.
  const scope = await resolveHeadScope(req.user);
  if (!scope.isSuper && !scopeAllowsDepartment(scope, department)) {
    res.status(403);
    throw new Error('You can only add employees to a department you head');
  }

  const idClash = await Employee.findOne({ employeeId });
  if (idClash) {
    res.status(409);
    throw new Error(`Employee ID ${employeeId} is already taken`);
  }
  if (email) {
    const emailClash = await Employee.findOne({ email });
    if (emailClash) {
      res.status(409);
      throw new Error('That email is already registered');
    }
  }

  const employee = await Employee.create({
    name,
    employeeId,
    email: email || undefined,
    phone,
    designation,
    department,
    password,
    role: 'employee',
  });

  const safe = employee.toObject();
  delete safe.password;
  res.status(201).json({ message: `${name} added to ${department}`, employee: safe });
});

// @desc Preview the approved leaves in the current weekly digest window
// @route GET /api/manage/weekly-digest
export const getWeeklyDigestPreview = asyncHandler(async (req, res) => {
  if (!isSuperAdmin(req.user)) {
    res.status(403);
    throw new Error('Only the super admin can view the weekly digest');
  }

  const result = await getApprovedLeavesForWeek();
  res.json(result);
});

// @desc Manually send the weekly digest to heads for testing
// @route POST /api/manage/weekly-digest/send
export const sendWeeklyDigestNow = asyncHandler(async (req, res) => {
  if (!isSuperAdmin(req.user)) {
    res.status(403);
    throw new Error('Only the super admin can send the weekly digest');
  }

  const result = await sendWeeklyHeadDigest();
  res.json({
    message: `Weekly digest sent to ${result.heads} head(s)`,
    heads: result.heads,
    leaveCount: result.leaveCount,
    weekStart: result.weekStart,
    weekEnd: result.weekEnd,
  });
});
