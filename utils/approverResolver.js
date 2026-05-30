import Employee from '../models/Employee.js';
import Department from '../models/Department.js';

const HEAD_FIELDS = '_id name email employeeId department role';

// Resolve who approves a leave for a given applicant.
//
//   employee  -> the active dept_head of their department.
//                Department.heads can also contain overall `head` users, so
//                this path must explicitly filter to role `dept_head`.
//   dept_head -> an overall head for their department. Heads don't apply leave,
//                so they have no approver.
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
        role: 'dept_head',
        department: applicant.department,
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
    const department = await Department.findOne({
      name: applicant.department,
      active: true,
    }).select('heads');

    if (!department?.heads?.length) return null;

    return Employee.findOne({
      _id: { $in: department.heads, $ne: applicant._id },
      role: 'head',
      active: true,
    })
      .select(HEAD_FIELDS)
      .lean();
  }

  return null;
};

// All currently-active dept_heads of a department, used by the review-queue
// scope and by notification fan-out on apply. Overall `head` users are not
// included here; they are notified only after a dept_head approves.
export const listDepartmentHeads = async (departmentName, { excludeId } = {}) => {
  if (!departmentName) return [];
  const department = await Department.findOne({
    name: departmentName,
    active: true,
  }).select('heads');

  const ids = department?.heads?.length ? department.heads : null;
  const filter = ids
    ? { _id: { $in: ids }, active: true, role: 'dept_head', department: departmentName }
    : { role: 'dept_head', department: departmentName, active: true };
  if (excludeId) filter._id = { ...(filter._id || {}), $ne: excludeId };

  return Employee.find(filter).select(HEAD_FIELDS).lean();
};

// Overall Heads group for a department. These users receive the post-approval
// workforce review notification and can overturn an approved leave before it
// starts.
export const listDepartmentOverallHeads = async (departmentName, { excludeId } = {}) => {
  if (!departmentName) return [];
  const department = await Department.findOne({
    name: departmentName,
    active: true,
  }).select('heads');

  if (!department?.heads?.length) return [];

  const filter = {
    _id: { $in: department.heads },
    active: true,
    role: 'head',
  };
  if (excludeId) filter._id = { ...filter._id, $ne: excludeId };

  return Employee.find(filter).select(HEAD_FIELDS).lean();
};
