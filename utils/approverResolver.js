import Employee from '../models/Employee.js';
import {
  DEPARTMENT_HEAD_APPROVALS,
  DEPARTMENT_POST_APPROVAL_HEAD_EMAILS,
  normalizeDepartmentName,
} from './constants.js';

const HEAD_FIELDS = '_id name email notificationEmail employeeId department role';

const normalizedEmails = (values = []) => [
  ...new Set(
    values
      .map((value) => String(value || '').trim().toLowerCase())
      .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
  ),
];

const approvalEmailsForEmployee = (employee) => normalizedEmails(employee?.headNotificationEmails || []);

const employeeIdOf = (employee) => String(employee?.employeeId || '').trim().toUpperCase();

const departmentHeadIdsForEmployee = (employee) =>
  DEPARTMENT_HEAD_APPROVALS[employeeIdOf(employee)] || [];

export const isDepartmentHeadRoutedEmployee = (employee) =>
  departmentHeadIdsForEmployee(employee).length > 0;

const displayNameFromEmail = (email) => {
  const localPart = String(email || '').split('@')[0] || 'head';
  return localPart
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const findHeadsByEmails = async (emails, { excludeId, excludeEmails = [], includeSynthetic = false } = {}) => {
  const normalized = normalizedEmails(emails);
  if (!normalized.length) return [];

  const filter = {
    active: true,
    role: 'head',
    $or: [
      { email: { $in: normalized } },
      { notificationEmail: { $in: normalized } },
    ],
  };
  if (excludeId) filter._id = { $ne: excludeId };

  const heads = await Employee.find(filter).select(HEAD_FIELDS).lean();
  if (!includeSynthetic) return heads;

  const excludedEmails = new Set(normalizedEmails(excludeEmails));
  if (excludeId) {
    const excludedHead = await Employee.findById(excludeId).select('email notificationEmail').lean();
    for (const email of normalizedEmails([excludedHead?.email, excludedHead?.notificationEmail])) {
      excludedEmails.add(email);
    }
  }

  const foundEmails = new Set(
    heads.flatMap((head) => normalizedEmails([head.email, head.notificationEmail]))
  );
  const synthetic = normalized
    .filter((email) => !foundEmails.has(email) && !excludedEmails.has(email))
    .map((email) => ({
      name: displayNameFromEmail(email),
      email,
      notificationEmail: email,
      role: 'head',
    }));
  return [...heads, ...synthetic];
};

export const listDepartmentHeadsForEmployee = async (employee, { excludeId } = {}) => {
  const employeeIds = departmentHeadIdsForEmployee(employee);
  if (!employeeIds.length) return [];

  const filter = {
    active: true,
    role: 'dept_head',
    employeeId: { $in: employeeIds },
  };
  if (excludeId) filter._id = { $ne: excludeId };

  return Employee.find(filter).select(HEAD_FIELDS).lean();
};

export const listDirectApprovalHeadsForEmployee = async (employee, { excludeId } = {}) => {
  const emails = approvalEmailsForEmployee(employee);
  return findHeadsByEmails(emails, { excludeId });
};

export const listApprovalHeadsForEmployee = async (employee, { excludeId } = {}) => {
  if (isDepartmentHeadRoutedEmployee(employee)) {
    const departmentHeads = await listDepartmentHeadsForEmployee(employee, { excludeId });
    if (departmentHeads.length) return departmentHeads;
  }

  const emails = approvalEmailsForEmployee(employee);
  if (!emails.length) return [];

  return findHeadsByEmails(emails, { excludeId });
};

export const listPostApprovalNoticeHeadsForEmployee = async (employee, { excludeId } = {}) => {
  if (isDepartmentHeadRoutedEmployee(employee)) {
    const department = normalizeDepartmentName(employee?.department);
    const emails = DEPARTMENT_POST_APPROVAL_HEAD_EMAILS[department] || approvalEmailsForEmployee(employee);
    return findHeadsByEmails(emails, { excludeId, includeSynthetic: true });
  }

  return findHeadsByEmails(approvalEmailsForEmployee(employee), {
    excludeId,
    includeSynthetic: true,
  });
};

// Resolve the primary approver stamped on the leave row. Notifications still
// fan out to every mapped Head, but this keeps the existing approver audit field
// useful for exports and old filters.
export const resolveApprover = async (applicant) => {
  if (!applicant || applicant.role === 'head') return null;
  const heads = await listApprovalHeadsForEmployee(applicant, { excludeId: applicant._id });
  return heads[0] || null;
};

// Back-compat exports for older imports.
export const listDepartmentHeads = listDepartmentHeadsForEmployee;
export const listDepartmentOverallHeads = listPostApprovalNoticeHeadsForEmployee;
