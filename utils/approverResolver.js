import Employee from '../models/Employee.js';
import Department from '../models/Department.js';

const HEAD_FIELDS = '_id name email employeeId department role';

// Resolve who approves a leave for a given applicant.
//
//   employee  -> any active dept_head of their department (multi-head aware).
//                Prefers the Department.heads list; falls back to legacy
//                role/department lookup so old data without a Department row
//                still routes correctly.
//   dept_head -> a head (any). Heads don't apply leave, so they have no approver.
//
// Returns the Employee doc (lean) or null when no suitable approver exists.
export const resolveApprover = async (applicant) => {
  if (!applicant) return null;

  if (applicant.role === 'employee') {
    const department = await Department.findOne({
      name: applicant.department,
      active: true,
    }).select('heads');

    if (department?.heads?.length) {
      const head = await Employee.findOne({
        _id: { $in: department.heads, $ne: applicant._id },
        active: true,
      })
        .select(HEAD_FIELDS)
        .lean();
      if (head) return head;
    }

    // Legacy fallback for departments not yet materialised.
    return Employee.findOne({
      role: 'dept_head',
      active: true,
      department: applicant.department,
      _id: { $ne: applicant._id },
    })
      .select(HEAD_FIELDS)
      .lean();
  }

  if (applicant.role === 'dept_head') {
    return Employee.findOne({
      role: 'head',
      active: true,
      _id: { $ne: applicant._id },
    })
      .select(HEAD_FIELDS)
      .lean();
  }

  return null;
};

// All currently-active dept_heads of a department, used by the review-queue
// scope (so each head of a multi-head department sees the same queue) and by
// the notification fan-out on apply.
export const listDepartmentHeads = async (departmentName, { excludeId } = {}) => {
  if (!departmentName) return [];
  const department = await Department.findOne({
    name: departmentName,
    active: true,
  }).select('heads');

  const ids = department?.heads?.length ? department.heads : null;
  const filter = ids
    ? { _id: { $in: ids }, active: true }
    : { role: 'dept_head', department: departmentName, active: true };
  if (excludeId) filter._id = { ...(filter._id || {}), $ne: excludeId };

  return Employee.find(filter).select(HEAD_FIELDS).lean();
};
