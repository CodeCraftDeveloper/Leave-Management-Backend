// Centralized enums and constants.

export const ROLES = Object.freeze({
  EMPLOYEE: 'employee',
  DEPT_HEAD: 'dept_head',
  HEAD: 'head',
  HR: 'hr',
});

// Roles that can review/approve leave requests of others.
export const REVIEWER_ROLES = Object.freeze(['dept_head', 'head']);

// The single overall super admin. Every other `head` is scoped to the
// department(s) they are mapped to via Department.heads; only this account
// has full, org-wide visibility and the global management powers (department
// CRUD, weekly digest, dept_head role assignment). Identified by the reserved
// login/notification email so no DB migration is needed.
export const SUPERADMIN_EMAIL = 'charan.f.sde@gmail.com';

export const EMPLOYEE_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
});

export const LEAVE_TYPES = Object.freeze({
  CASUAL: 'casual',
  SICK: 'sick',
  EMERGENCY: 'emergency',
  PAID: 'paid',
  UNPAID: 'unpaid',
});

export const PAID_LEAVE_TYPES = Object.freeze([
  LEAVE_TYPES.CASUAL,
  LEAVE_TYPES.SICK,
  LEAVE_TYPES.EMERGENCY,
  LEAVE_TYPES.PAID,
]);

// No yearly/type-wise leave quota exists. The only free-leave policy is the
// company-wide monthly allowance configured in DEFAULT_SETTINGS.monthlyFreeLeaves.
export const DEFAULT_YEARLY_QUOTA = Object.freeze({});

export const LEAVE_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
});

export const ATTENDANCE_STATUS = Object.freeze({
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  HALF_DAY: 'HALF_DAY',
  ON_LEAVE: 'ON_LEAVE',
  HOLIDAY: 'HOLIDAY',
  WEEK_OFF: 'WEEK_OFF',
  // Legacy transient states retained for old records:
  CHECKED_IN: 'checked-in',
  CHECKED_OUT: 'checked-out',
});

export const PAYROLL_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  GENERATED: 'GENERATED',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
});

// Company rules.
//   - Office hours 09:15–18:00 (purely informational; no late deduction).
//   - 2 free leaves per month; extra leaves deduct per-day salary.
//   - Sunday work pays double the per-day salary, but only if the employee
//     puts in at least `sundayMinHours` on that Sunday.
//   - No LOP, no gross, no hourly overtime — Sunday is the only "overtime".
export const DEFAULT_SETTINGS = Object.freeze({
  workStartTime: '09:15',
  workEndTime: '18:00',
  weekOffDays: [0], // Sunday — but Sunday work earns double pay.
  perDayMode: 'actual', // 'actual' = monthlySalary / daysInMonth.
  yearlyQuota: DEFAULT_YEARLY_QUOTA,
  monthlyFreeLeaves: 2,
  sundayMinHours: 6,
  sundayPayMultiplier: 2, // double-pay for qualifying Sunday work.
});
