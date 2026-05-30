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
  'Maintenance-Electrical',
  'Maintenance-Mechanical',
  'Printing-Cylinder',
  'Printing-01',
  'Printing-02',
  'Printing-Incharge',
  'Printing-Ink',
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
  // General
  hr: 'HR & Admin',
  'hr admin': 'HR & Admin',
  management: 'HR & Admin',

  // Pre Press
  'pre press': 'Pre-Press',
  'pre-press': 'Pre-Press',

  // Store
  'store deo': 'Store-Ops',
  'store-deo': 'Store-Ops',

  // Supervisors
  dispatch: 'Supervisor (Dispatch)',
  'supervisor dispatch': 'Supervisor (Dispatch)',
  'supervisor(dispatch)': 'Supervisor (Dispatch)',

  'supervisor production': 'Supervisor (Production)',
  'supervisor(production)': 'Supervisor (Production)',

  'supervisor ink': 'Supervisor (Ink)',
  'supervisor(ink)': 'Supervisor (Ink)',

  // PPC
  'ppc-deo': 'PPC',

  // Maintenance
  'maintenance-metrical': 'Maintenance-Electrical',
  'maintenance welder': 'Maintenance-Mechanical',
  'maintenance-welder': 'Maintenance-Mechanical',

  // Printing
  'printing cylinder': 'Printing-Cylinder',
  'printing-cylinder': 'Printing-Cylinder',

  'printing 01': 'Printing-01',
  'printing-1': 'Printing-01',

  'printing 02': 'Printing-02',
  'printing-2': 'Printing-02',

  'printing incharge': 'Printing-Incharge',
  'printing-incharge': 'Printing-Incharge',
  'printing-incahrge': 'Printing-Incharge',

  'printing ink': 'Printing-Ink',
  'printing-ink': 'Printing-Ink',

  // Lamination
  'lamination solvent less': 'Lamination - SEW NW HSS',
  'lamination - solvent less': 'Lamination - SEW NW HSS',

  'lamination solvent base': 'Lamination - SEW NW BASF',
  'lamination - solvent base': 'Lamination - SEW NW BASF',

  'lamination narendra': 'Lamination',
  'lamination-narendra': 'Lamination',
  'lamination - narendra': 'Lamination',

  // Quality
  inspection: 'Quality',

  // Forklift
  forlift: 'Forklift',
  fomfit: 'Forklift',

  // Blown Film
  'blown film unit 4': 'Blown Film Unit-4',
  'blown-film unit-4': 'Blown Film Unit-4',
  'blown film-unit-4': 'Blown Film Unit-4',
  'blown film - unit - 4': 'Blown Film Unit-4',
});

const normalizedDepartmentAliasLookup = new Map(
  Object.entries(DEPARTMENT_ALIASES).map(([alias, name]) => [
    normalizeDepartmentKey(alias),
    name,
  ])
);

export const normalizeDepartmentName = (value) => {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) return '';

  const key = normalizeDepartmentKey(name);

  return (
    normalizedDepartmentLookup.get(key) ||
    normalizedDepartmentAliasLookup.get(key) ||
    name
  );
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
