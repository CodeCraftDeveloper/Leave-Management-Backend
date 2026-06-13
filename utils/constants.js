// Centralized enums and constants.

export const ROLES = Object.freeze({
  EMPLOYEE: 'employee',
  HEAD: 'head',
  HR: 'hr',
});

// Roles that can review/approve leave requests of others.
// Heads review requests routed through Employee.headNotificationEmails.
export const REVIEWER_ROLES = Object.freeze(['head']);

// Hybrid approval routing — Accounts and Digital Market only. The first reviewer
export const DEPARTMENT_NAMES = Object.freeze([
  'Accounts',
  'Billing',
  'Blown -Film Unit -4',
  'Blown Film',
  'Blown Film - Recycle',
  'Boiler',
  'DRIVER',
  'Digital Market',
  'E-com',
  'EPR',
  'Extrusion',
  'Forklift',
  'Forlift',
  'Hr',
  'Hr & Admin',
  'Inspection',
  'Lamination - SOLVENT BASE',
  'Lamination - SOLVENT LESS',
  'Lamination- NARENDRA',
  'Maintenance',
  'Maintenance-Electrical',
  'Maintenance-Mechanical',
  'Maintenance-Welder',
  'PPC',
  'Pantry',
  'Pouch',
  'Ppc',
  'Ppc-Deo',
  'Pre -Press',
  'Printing -01',
  'Printing -02',
  'Printing-Incahrge',
  'Printing-Ink',
  'Printing-cylinder',
  'Production',
  'Quality',
  'Slitting',
  'Store',
  'Store -Deo',
  'Supervisor( Dispatch)',
  'Supervisor(Ink )',
  'Supervisor(Production)',
  'WAREHOUSE',
]);

const normalizeDepartmentKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-');

// First-entry-wins Map so the earliest DEPARTMENT_NAMES entry for a
// given normalized key is treated as the canonical fallback.
const normalizedDepartmentLookup = new Map();
for (const name of DEPARTMENT_NAMES) {
  const key = normalizeDepartmentKey(name);
  if (!normalizedDepartmentLookup.has(key)) {
    normalizedDepartmentLookup.set(key, name);
  }
}



const DEPARTMENT_ALIASES = Object.freeze({
  // General
  'hr admin': 'Hr & Admin',
  management: 'Hr & Admin',

  // Pre Press
  'pre press': 'Pre -Press',
  'pre-press': 'Pre -Press',

  // Store
  'store deo': 'Store -Deo',
  'store-deo': 'Store -Deo',

  // Supervisors
  dispatch: 'Supervisor( Dispatch)',
  'supervisor dispatch': 'Supervisor( Dispatch)',
  'supervisor (dispatch)': 'Supervisor( Dispatch)',
  'supervisor( dispatch)': 'Supervisor( Dispatch)',
  'supervisor(dispatch )': 'Supervisor( Dispatch)',

  'supervisor production': 'Supervisor(Production)',
  'supervisor (production)': 'Supervisor(Production)',
  'supervisor( production)': 'Supervisor(Production)',
  'supervisor(production )': 'Supervisor(Production)',

  'supervisor ink': 'Supervisor(Ink )',
  'supervisor (ink)': 'Supervisor(Ink )',
  'supervisor( ink)': 'Supervisor(Ink )',
  'supervisor(ink )': 'Supervisor(Ink )',

  // PPC
  ppc_deo: 'Ppc-Deo',
  'ppc-deo': 'Ppc-Deo',

  // Maintenance
  'maintenance-metrical': 'Maintenance-Electrical',
  'maintenance welder': 'Maintenance-Welder',
  'maintenance-welder': 'Maintenance-Welder',

  // Printing
  'printing cylinder': 'Printing-cylinder',
  'printing-cylinder': 'Printing-cylinder',

  'printing 01': 'Printing -01',
  'printing-1': 'Printing -01',
  'printing-01': 'Printing -01',

  'printing 02': 'Printing -02',
  'printing-2': 'Printing -02',
  'printing-02': 'Printing -02',

  'printing incharge': 'Printing-Incahrge',
  'printing-incharge': 'Printing-Incahrge',
  'printing-incahrge': 'Printing-Incahrge',

  'printing ink': 'Printing-Ink',
  'printing-ink': 'Printing-Ink',
  'printing -ink': 'Printing-Ink',

  // Lamination
  'lamination solvent less': 'Lamination - SOLVENT LESS',
  'lamination - solvent less': 'Lamination - SOLVENT LESS',
  'lamination - sew nw hss': 'Lamination - SOLVENT LESS',

  'lamination solvent base': 'Lamination - SOLVENT BASE',
  'lamination - solvent base': 'Lamination - SOLVENT BASE',
  'lamination - sew nw basf': 'Lamination - SOLVENT BASE',

  'lamination narendra': 'Lamination- NARENDRA',
  'lamination-narendra': 'Lamination- NARENDRA',
  'lamination - narendra': 'Lamination- NARENDRA',

  // Quality
  inspection: 'Inspection',

  // Forklift
  forlift: 'Forlift',
  fomfit: 'Forklift',

  // Blown Film
  'blown film unit 4': 'Blown -Film Unit -4',
  'blown-film unit-4': 'Blown -Film Unit -4',
  'blown film-unit-4': 'Blown -Film Unit -4',
  'blown film - unit - 4': 'Blown -Film Unit -4',
  'blown-film-unit-4': 'Blown -Film Unit -4',
  'blown film unit-4': 'Blown -Film Unit -4',

  // Case variants
  driver: 'DRIVER',
  warehouse: 'WAREHOUSE',
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

  // Exact match first — preserves case-distinct names (e.g. PPC vs Ppc)
  if (DEPARTMENT_NAMES.includes(name)) return name;

  const key = normalizeDepartmentKey(name);

  return (
    normalizedDepartmentLookup.get(key) ||
    normalizedDepartmentAliasLookup.get(key) ||
    name
  );
};

// Overall super admins. Every other `head` is scoped by
// Employee.headNotificationEmails. Identified by reserved login/notification
// email so no DB migration is needed.
export const SUPERADMIN_EMAILS = Object.freeze([
  'charan.f.sde@gmail.com',
  'rajan.kumar@premindustries.in',
]);

// Back-compat for older imports that expect a single primary email.
export const SUPERADMIN_EMAIL = SUPERADMIN_EMAILS[0];

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
  weekOffDays: [],
  perDayMode: 'actual', // 'actual' = monthlySalary / daysInMonth.
  yearlyQuota: DEFAULT_YEARLY_QUOTA,
  monthlyFreeLeaves: 2,
  sundayMinHours: 6,
  sundayPayMultiplier: 2, // double-pay for qualifying Sunday work.
});
