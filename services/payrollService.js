import Attendance from '../models/Attendance.js';
import Employee from '../models/Employee.js';
import Holiday from '../models/Holiday.js';
import Leave from '../models/Leave.js';
import Payroll from '../models/Payroll.js';
import SalaryStructure from '../models/SalaryStructure.js';
import Settings from '../models/Settings.js';
import { daysInMonth, monthRange, eachDayInRange } from '../utils/dateHelpers.js';

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const otCreditDateFor = (month, year) => new Date(Date.UTC(year, month - 1, 25));

/**
 * Aggregate attendance + leaves into the numbers payroll cares about.
 * Pure read — no DB writes — so this also serves as the "preview" engine.
 *
 * Rules:
 *   • Sundays count as week-offs; Sunday work counts toward `sundaysWorked`
 *     IF the employee logged at least `settings.sundayMinHours` that day.
 *   • Leave days falling on the month are summed into `leavesTaken`.
 *   • Sunday leaves are ignored (you can't take leave on a day off).
 *   • Free leaves quota is per month; extras deduct per-day pay.
 */
export const buildMonthlySummary = async (employee, month, year) => {
  const totalDaysInMonth = daysInMonth(year, month);
  const { start, end } = monthRange(year, month);
  const settings = await Settings.get();
  const weekOffSet = new Set(settings.weekOffDays || [0]);

  const [attendance, approvedLeaves, holidays] = await Promise.all([
    Attendance.find({ employee: employee._id, date: { $gte: start, $lte: end } }),
    Leave.find({
      employee: employee._id,
      status: 'approved',
      startDate: { $lte: end },
      endDate: { $gte: start },
    }),
    Holiday.find({ date: { $gte: start, $lte: end } }),
  ]);

  const holidayDates = new Set(holidays.map((h) => new Date(h.date).toDateString()));
  const attendanceByDate = new Map(
    attendance.map((a) => [new Date(a.date).toDateString(), a])
  );

  // Expand approved leaves into a per-day map.
  const leaveDayMap = new Map();
  for (const lv of approvedLeaves) {
    const days = eachDayInRange(
      new Date(Math.max(new Date(lv.startDate).getTime(), start.getTime())),
      new Date(Math.min(new Date(lv.endDate).getTime(), end.getTime()))
    );
    for (const d of days) {
      if (weekOffSet.has(d.getDay())) continue;
      leaveDayMap.set(d.toDateString(), { portion: lv.isHalfDay ? 0.5 : 1 });
    }
  }

  let presentDays = 0;
  let absentDays = 0;
  let leavesTaken = 0;
  let weekOffDays = 0;
  let holidayDays = 0;
  let sundaysWorked = 0;

  for (let d = 1; d <= totalDaysInMonth; d++) {
    const day = new Date(Date.UTC(year, month - 1, d));
    const dStr = day.toDateString();
    const dow = day.getDay();
    const att = attendanceByDate.get(dStr);
    const isWeekOff = weekOffSet.has(dow);
    const isHoliday = holidayDates.has(dStr);

    // Sunday work check (independent of week-off bookkeeping).
    if (isWeekOff && att && Number(att.workHours || 0) >= settings.sundayMinHours) {
      sundaysWorked += 1;
    }

    if (isWeekOff) { weekOffDays += 1; continue; }
    if (isHoliday) { holidayDays += 1; continue; }

    const leave = leaveDayMap.get(dStr);

    if (att && att.status === 'HALF_DAY') {
      // Half day worked → counts as half a present day (earns half pay).
      presentDays += 0.5;
      continue;
    }
    if (att && att.checkIn) {
      // Real attendance always wins over a leave stamp.
      presentDays += 1;
      continue;
    }
    if (leave) {
      leavesTaken += leave.portion;
      // Half-day leave with no attendance on the other half = half absent.
      if (leave.portion < 1) absentDays += 1 - leave.portion;
      continue;
    }
    if (att && att.status === 'ON_LEAVE') {
      leavesTaken += 1;
      continue;
    }
    // Nothing recorded and not on leave/holiday/week-off → unexcused absent.
    absentDays += 1;
  }

  return {
    totalDaysInMonth,
    presentDays: r2(presentDays),
    absentDays: r2(absentDays),
    leavesTaken: r2(leavesTaken),
    sundaysWorked,
    weekOffDays,
    holidayDays,
  };
};

/**
 * Compute payroll numbers for an employee for the given month.
 * Formula:
 *   perDay         = monthlySalary / totalDaysInMonth   (actual mode)
 *   extraLeaveDays = max(0, leavesTaken - freeLeaves)
 *   leaveDeduction = extraLeaveDays * perDay + absentDays * perDay
 *   otSalary       = sundaysWorked * perDay * 2
 *   netSalary      = monthlySalary - leaveDeduction
 *   totalPayable   = netSalary + otSalary
 *
 * Note: absentDays (no leave, no attendance) also deduct per-day salary,
 * because otherwise an employee could ghost without consequence.
 */
export const computePayroll = async (employee, month, year, opts = {}) => {
  const settings = await Settings.get();
  const structure = await SalaryStructure.findOne({ employee: employee._id });

  const monthlySalary = Number(
    opts.monthlySalary ?? structure?.monthlySalary ?? employee.monthlySalary ?? 0
  );
  const summary = await buildMonthlySummary(employee, month, year);

  const divisor = settings.perDayMode === 'fixed30' ? 30 : summary.totalDaysInMonth;
  const perDaySalary = r2(divisor > 0 ? monthlySalary / divisor : 0);

  const freeLeaves = Number(opts.freeLeaves ?? settings.monthlyFreeLeaves ?? 0);
  const extraLeaveDays = r2(Math.max(0, summary.leavesTaken - freeLeaves));
  const deductibleDays = r2(extraLeaveDays + summary.absentDays);
  const leaveDeduction = r2(deductibleDays * perDaySalary);

  const otSalary = r2(summary.sundaysWorked * perDaySalary * settings.sundayPayMultiplier);
  const netSalary = r2(Math.max(0, monthlySalary - leaveDeduction));
  const totalPayable = r2(netSalary + otSalary);

  return {
    ...summary,
    monthlySalary: r2(monthlySalary),
    perDaySalary,
    freeLeaves,
    extraLeaveDays,
    leaveDeduction,
    sundayBonus: otSalary,
    otSalary,
    otCreditDate: otCreditDateFor(month, year),
    totalPayable,
    netSalary,
  };
};

/**
 * Live earnings tracker for the employee salary screen.
 * Earnings are driven by ACTUAL attendance, based on monthly salary (gross):
 *   perDay          = monthlySalary / totalDaysInMonth
 *   currentEarnings = presentDays   * perDay   (full present days only;
 *                                               leaves & absents are not paid)
 *   sundayEarnings  = sundaysWorked * perDay * sundayPayMultiplier
 * Pure read — no DB writes.
 */
export const computeLiveEarnings = async (employee, month, year) => {
  const [structure, settings] = await Promise.all([
    SalaryStructure.findOne({ employee: employee._id }),
    Settings.get(),
  ]);
  const monthlySalary = Number(structure?.monthlySalary ?? employee.monthlySalary ?? 0);
  const basicSalary = Number(structure?.basicSalary ?? 0);
  const summary = await buildMonthlySummary(employee, month, year);

  const perDaySalary = r2(
    summary.totalDaysInMonth > 0 ? monthlySalary / summary.totalDaysInMonth : 0
  );
  const currentEarnings = r2(summary.presentDays * perDaySalary);
  const sundayEarnings = r2(summary.sundaysWorked * perDaySalary * settings.sundayPayMultiplier);

  return {
    month,
    year,
    monthlySalary: r2(monthlySalary),
    basicSalary: r2(basicSalary),
    totalDaysInMonth: summary.totalDaysInMonth,
    presentDays: summary.presentDays,
    absentDays: summary.absentDays,
    leavesTaken: summary.leavesTaken,
    sundaysWorked: summary.sundaysWorked,
    perDaySalary,
    currentEarnings,
    sundayEarnings,
  };
};

export const generatePayrollForEmployee = async (employeeId, month, year, opts = {}, actorId) => {
  const employee = await Employee.findById(employeeId);
  if (!employee) throw Object.assign(new Error('Employee not found'), { statusCode: 404 });
  if (!employee.active) throw Object.assign(new Error('Employee is inactive'), { statusCode: 400 });

  const existing = await Payroll.findOne({ employee: employeeId, month, year });
  if (existing && existing.status === 'PAID' && !opts.force) {
    throw Object.assign(new Error('Payroll is already paid; cannot regenerate'), { statusCode: 409 });
  }

  const computed = await computePayroll(employee, month, year, opts);
  const payload = {
    employee: employeeId,
    month,
    year,
    ...computed,
    status: 'GENERATED',
    generatedBy: actorId,
    remarks: opts.remarks || '',
  };

  if (existing) {
    Object.assign(existing, payload);
    await existing.save();
    return existing;
  }
  return Payroll.create(payload);
};

/** Printable payslip view from a Payroll row. */
export const buildPayslip = async (payroll) => {
  await payroll.populate('employee', 'employeeId name email department designation joiningDate');
  const structure = await SalaryStructure.findOne({ employee: payroll.employee._id });
  return {
    employee: payroll.employee,
    period: { month: payroll.month, year: payroll.year },
    attendance: {
      totalDaysInMonth: payroll.totalDaysInMonth,
      presentDays: payroll.presentDays,
      absentDays: payroll.absentDays,
      leavesTaken: payroll.leavesTaken,
      freeLeaves: payroll.freeLeaves,
      extraLeaveDays: payroll.extraLeaveDays,
      sundaysWorked: payroll.sundaysWorked,
      weekOffDays: payroll.weekOffDays,
      holidayDays: payroll.holidayDays,
    },
    salary: {
      monthlySalary: payroll.monthlySalary,
      perDaySalary: payroll.perDaySalary,
      leaveDeduction: payroll.leaveDeduction,
      sundayBonus: payroll.sundayBonus,
      otSalary: payroll.otSalary ?? payroll.sundayBonus ?? 0,
      otCreditDate: payroll.otCreditDate || otCreditDateFor(payroll.month, payroll.year),
      totalPayable: payroll.totalPayable ?? r2((payroll.netSalary || 0) + (payroll.otSalary ?? payroll.sundayBonus ?? 0)),
      netSalary: payroll.netSalary,
    },
    // CTC-style salary structure breakdown for the payslip line-items.
    // `grossSalary` mirrors monthlySalary (the payroll base) for clarity.
    structure: structure
      ? {
          grossSalary: structure.monthlySalary,
          basicSalary: structure.basicSalary,
          other: structure.other,
          bonus: structure.bonus,
          gratuity: structure.gratuity,
          employerPf: structure.employerPf,
          employerEsic: structure.employerEsic,
          ctc: structure.ctc,
          deduction: structure.deduction,
          employeePf: structure.employeePf,
          employeeEsic: structure.employeeEsic,
        }
      : null,
    status: payroll.status,
    paidAt: payroll.paidAt,
    generatedAt: payroll.createdAt,
  };
};
