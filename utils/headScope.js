import Employee from '../models/Employee.js';
import Department from '../models/Department.js';
import { SUPERADMIN_EMAIL } from './constants.js';

// Heads are department-scoped reviewers: each `head` only sees and acts on the
// department(s) they are mapped to via Department.heads. The lone exception is
// the super admin (charan.f.sde@gmail.com), who keeps full org-wide visibility.
//
// Identity is resolved off the reserved email — checked against both the login
// `email` and the seeded `notificationEmail` so it works whether the account
// logs in directly or was seeded as a notification-only head.
export const isSuperAdmin = (user) => {
  if (!user) return false;
  const candidates = [user.email, user.notificationEmail].map((value) =>
    String(value || '').trim().toLowerCase()
  );
  return candidates.includes(SUPERADMIN_EMAIL);
};

// Names of the departments a head oversees (membership in Department.heads).
export const departmentsForHead = async (user) => {
  if (!user?._id) return [];
  const departments = await Department.find({ heads: user._id, active: true }).select('name');
  return departments.map((d) => d.name);
};

// Resolve a head's scope once: whether they are unrestricted (super admin) plus
// the department names and employee _ids they are allowed to touch.
//
//   { isSuper: true,  departmentNames: null, employeeIds: null }  -> see everything
//   { isSuper: false, departmentNames: [..], employeeIds: [..] }  -> limited
//
// A scoped head with no mapped department resolves to empty arrays, which the
// callers turn into an "empty" filter so nothing leaks.
export const resolveHeadScope = async (user) => {
  if (isSuperAdmin(user)) {
    return { isSuper: true, departmentNames: null, employeeIds: null };
  }
  const departmentNames = await departmentsForHead(user);
  const employees = departmentNames.length
    ? await Employee.find({ department: { $in: departmentNames } }).select('_id')
    : [];
  return {
    isSuper: false,
    departmentNames,
    employeeIds: employees.map((e) => e._id),
  };
};

// Intersect a candidate list of employee ids with a head's scope. When the head
// is unrestricted (scope.employeeIds === null) the candidates pass through. Used
// to combine a search/department filter with the head's visibility.
export const intersectWithScope = (scope, candidateIds) => {
  if (!scope || scope.employeeIds === null) return candidateIds;
  const allowed = new Set(scope.employeeIds.map(String));
  return candidateIds.filter((id) => allowed.has(String(id)));
};

// True when a head may see/act on a given employee (by their department).
export const scopeAllowsDepartment = (scope, departmentName) => {
  if (!scope || scope.departmentNames === null) return true;
  return scope.departmentNames.includes(departmentName);
};
