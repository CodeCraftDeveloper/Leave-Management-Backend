import Employee from '../models/Employee.js';

// Resolve who approves a leave for a given applicant.
//
//   employee  -> dept_head of same department (active)
//   dept_head -> any head (active). Heads don't apply leave, so they have no approver.
//
// Returns the Employee doc (lean) or null when no suitable approver exists.
// Caller is responsible for handling the null case (we surface a clear error
// rather than silently dropping the request).
export const resolveApprover = async (applicant) => {
  if (!applicant) return null;
  const role = applicant.role;

  if (role === 'employee') {
    return Employee.findOne({
      role: 'dept_head',
      active: true,
      department: applicant.department,
      _id: { $ne: applicant._id },
    })
      .select('_id name email employeeId department role')
      .lean();
  }

  if (role === 'dept_head') {
    return Employee.findOne({
      role: 'head',
      active: true,
      _id: { $ne: applicant._id },
    })
      .select('_id name email employeeId department role')
      .lean();
  }

  // Heads (and any other role) don't apply leave through this flow.
  return null;
};
