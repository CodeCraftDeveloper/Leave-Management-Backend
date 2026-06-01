import asyncHandler from 'express-async-handler';
import Employee from '../models/Employee.js';
import Attendance from '../models/Attendance.js';
import Leave from '../models/Leave.js';
import Payroll from '../models/Payroll.js';
import { getYearlyBalances } from '../services/leaveBalanceService.js';
import { startOfDayIST, monthRange } from '../utils/dateHelpers.js';
import { resolveHeadScope } from '../utils/headScope.js';

// GET /api/dashboard/employee  (self)
export const employeeDashboard = asyncHandler(async (req, res) => {
  const employeeId = req.user._id;
  const today = startOfDayIST();
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const { start, end } = monthRange(year, month);

  const [todayAttendance, monthAttendance, pendingLeaves, balances, latestPayroll] = await Promise.all([
    Attendance.findOne({ employee: employeeId, date: today }),
    Attendance.find({ employee: employeeId, date: { $gte: start, $lte: end } }),
    Leave.find({ employee: employeeId, status: 'pending' }).sort({ createdAt: -1 }).limit(5),
    getYearlyBalances(employeeId, year),
    Payroll.findOne({ employee: employeeId }).sort({ year: -1, month: -1 }),
  ]);

  const monthSummary = monthAttendance.reduce(
    (acc, r) => {
      acc.byStatus[r.status] = (acc.byStatus[r.status] || 0) + 1;
      acc.workHours += Number(r.workHours || 0);
      acc.overtimeHours += Number(r.overtimeHours || 0);
      return acc;
    },
    { byStatus: {}, workHours: 0, overtimeHours: 0 }
  );

  res.json({
    profile: {
      _id: req.user._id,
      name: req.user.name,
      employeeId: req.user.employeeId,
      department: req.user.department,
      designation: req.user.designation,
      role: req.user.role,
    },
    todayAttendance,
    monthSummary,
    pendingLeaves,
    leaveBalances: balances,
    latestPayroll,
  });
});

// GET /api/dashboard/admin  (admin/hr)
export const adminDashboard = asyncHandler(async (req, res) => {
  if (!['head', 'hr'].includes(req.user.role)) {
    res.status(403);
    throw new Error('Head/HR access required');
  }
  const today = startOfDayIST();
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // Heads are employee-scoped by Employee.headNotificationEmails; the super
  // admin sees the whole organisation.
  const scope = await resolveHeadScope(req.user);
  const headcountScope = scope.isSuper ? {} : { _id: { $in: scope.employeeIds } };
  const employeeScope = scope.isSuper ? {} : { employee: { $in: scope.employeeIds } };
  const attendanceScope = scope.isSuper ? {} : { employee: { $in: scope.employeeIds } };

  const [totalEmployees, activeEmployees, todayRecords, pendingLeaves, payrollAgg] = await Promise.all([
    Employee.countDocuments({ role: { $in: ['employee', 'hr'] }, ...headcountScope }),
    Employee.countDocuments({ role: { $in: ['employee', 'hr'] }, active: true, ...headcountScope }),
    Attendance.find({ date: today, ...attendanceScope }),
    Leave.countDocuments({ status: 'pending', ...employeeScope }),
    Payroll.aggregate([
      { $match: { month, year, ...employeeScope } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          salaryTotal: { $sum: '$netSalary' },
          otTotal: { $sum: { $ifNull: ['$otSalary', { $ifNull: ['$sundayBonus', 0] }] } },
          totalPayable: {
            $sum: {
              $ifNull: [
                '$totalPayable',
                { $add: ['$netSalary', { $ifNull: ['$otSalary', { $ifNull: ['$sundayBonus', 0] }] }] },
              ],
            },
          },
        },
      },
    ]),
  ]);

  const presentCount = todayRecords.filter((r) =>
    ['PRESENT', 'LATE', 'HALF_DAY', 'checked-in', 'checked-out'].includes(r.status)
  ).length;
  const onLeaveCount = todayRecords.filter((r) => r.status === 'ON_LEAVE').length;
  const absentCount = Math.max(0, activeEmployees - presentCount - onLeaveCount);

  const payrollByStatus = payrollAgg.reduce((acc, row) => {
    acc[row._id] = { count: row.count, total: row.total };
    return acc;
  }, {});

  res.json({
    counts: {
      totalEmployees,
      activeEmployees,
      todayPresent: presentCount,
      todayAbsent: absentCount,
      todayOnLeave: onLeaveCount,
      pendingLeaves,
    },
    currentMonthPayroll: { month, year, ...payrollByStatus },
  });
});
