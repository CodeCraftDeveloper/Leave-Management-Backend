import Employee from '../models/Employee.js';
import {
  DEPARTMENT_HEAD_APPROVALS,
  DEPARTMENT_HEAD_FIRST_APPROVAL_EMPLOYEE_IDS,
  SUPERADMIN_EMAILS,
} from './constants.js';

// Heads are employee-scoped reviewers: each `head` only sees and acts on
// employees whose headNotificationEmails contain that head's login or
// notification email. Super admins keep full org-wide visibility.
//
// Identity is resolved off the reserved email — checked against both the login
// `email` and the seeded `notificationEmail` so it works whether the account
// logs in directly or was seeded as a notification-only head.
export const isSuperAdmin = (user) => {
  if (!user) return false;
  const candidates = [user.email, user.notificationEmail].map((value) =>
    String(value || '').trim().toLowerCase()
  );
  return candidates.some((email) => SUPERADMIN_EMAILS.includes(email));
};

export const headEmailsForUser = (user) => [
  ...new Set(
    [user?.email, user?.notificationEmail]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  ),
];

const employeeFilterForHead = (user) => {
  const emails = headEmailsForUser(user);
  const departmentHeadEmployeeId = String(user?.employeeId || '').trim().toUpperCase();
  const departmentHeadRoutedEmployeeIds = Object.entries(DEPARTMENT_HEAD_APPROVALS)
    .filter(([, approverIds]) => approverIds.includes(departmentHeadEmployeeId))
    .map(([employeeId]) => employeeId)
    .filter((employeeId) => employeeId !== departmentHeadEmployeeId);

  const visibilityRules = [];
  if (emails.length) {
    visibilityRules.push({
      headNotificationEmails: { $in: emails },
      employeeId: { $nin: DEPARTMENT_HEAD_FIRST_APPROVAL_EMPLOYEE_IDS },
    });
  }
  if (departmentHeadRoutedEmployeeIds.length) {
    visibilityRules.push({ employeeId: { $in: departmentHeadRoutedEmployeeIds } });
  }

  if (!visibilityRules.length) return { _id: null };
  return {
    active: true,
    role: { $in: ['employee', 'dept_head'] },
    $or: visibilityRules,
  };
};

// Names of the departments a head oversees through routed employees. Kept for
// existing dashboard and department screens, but it is no longer the approval
// authority.
export const departmentsForHead = async (user) => {
  if (!user?._id) return [];
  if (isSuperAdmin(user)) {
    return Employee.distinct('department', { active: true, role: { $in: ['employee', 'dept_head'] } });
  }
  return Employee.distinct('department', employeeFilterForHead(user));
};

// Resolve a head's scope once: whether they are unrestricted (super admin) plus
// the department names and employee _ids they are allowed to touch.
//
//   { isSuper: true,  departmentNames: null, employeeIds: null }  -> see everything
//   { isSuper: false, departmentNames: [..], employeeIds: [..] }  -> limited
//
// A scoped head with no routed employees resolves to empty arrays, which the
// callers turn into an "empty" filter so nothing leaks.
export const resolveHeadScope = async (user) => {
  if (isSuperAdmin(user)) {
    return { isSuper: true, departmentNames: null, employeeIds: null };
  }
  const employees = await Employee.find(employeeFilterForHead(user)).select('_id department');
  const departmentNames = [...new Set(employees.map((e) => e.department).filter(Boolean))];
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
