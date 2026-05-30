// Centralized enums and constants.

export const ROLES = Object.freeze({
  EMPLOYEE: 'employee',
  DEPT_HEAD: 'dept_head',
  HEAD: 'head',
  HR: 'hr',
});

// Roles that can review/approve leave requests of others.
export const REVIEWER_ROLES = Object.freeze(['dept_head', 'head']);

export const DEPARTMENT_NAMES = Object.freeze([
  'Production',
  'Maintenance',
  'HR & Admin',
  'Accounts',
  'E-com',
  'Pre-Press',
  'Digital Market',
  'Billing',
  'EPR',
  'Store',
  'Store-Ops',
  'Supervisor (Dispatch)',
  'Supervisor (Production)',
  'Supervisor (Ink)',
  'PPC',
  'Pig-In',
  'Pig-Dino',
  'Maintenance-Electrical',
  'Maintenance-Mechanical',
  'Printing-Cylinder',
  'Printing-01',
  'Printing-11',
  'Printing-17',
  'Printing-Ink',
  'Printing-Slitting',
  'Extrusion',
  'Lamination',
  'Lamination - SEW NW HSS',
  'Lamination - SEW NW BASF',
  'Slitting',
  'Quality',
  'Pouch',
  'Boiler',
  'Pantry',
  'Forklift',
  'Warehouse',
  'Driver',
  'Blown Film',
  'Blown Film - Recycle',
  'Blown Film Unit-4',
]);

const normalizeDepartmentKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-');

const normalizedDepartmentLookup = new Map(
  DEPARTMENT_NAMES.map((name) => [normalizeDepartmentKey(name), name])
);

const DEPARTMENT_ALIASES = Object.freeze({
  'unit head': 'Production',
  hr: 'HR & Admin',
  'pre press': 'Pre-Press',
  'store-deo': 'Store-Ops',
  dispatch: 'Supervisor (Dispatch)',
  'supervisor ink': 'Supervisor (Ink)',
  'ppc-deo': 'Pig-Dino',
  'maintenance-metrical': 'Maintenance-Electrical',
  'maintenance-welder': 'Maintenance-Mechanical',
  inspection: 'Boiler',
  'printing-02': 'Printing-17',
  'printing ink': 'Printing-Ink',
  'printing incharge': 'Printing-Slitting',
  'printing-incharge': 'Printing-Slitting',
  'lamination - solvent less': 'Lamination - SEW NW HSS',
  'lamination - solvent base': 'Lamination - SEW NW BASF',
  'lamination - narenda': 'Lamination',
  'lamination-narendra': 'Lamination',
  forlift: 'Forklift',
  fomfit: 'Forklift',
  management: 'HR & Admin',
  'blown film - unit - 4': 'Blown Film Unit-4',
  'blown-film unit-4': 'Blown Film Unit-4',
});

const normalizedDepartmentAliasLookup = new Map(
  Object.entries(DEPARTMENT_ALIASES).map(([alias, name]) => [normalizeDepartmentKey(alias), name])
);

export const normalizeDepartmentName = (value) => {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) return '';
  const key = normalizeDepartmentKey(name);
  return normalizedDepartmentLookup.get(key) || normalizedDepartmentAliasLookup.get(key) || name;
};

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
