import Employee from '../models/Employee.js';
import Leave from '../models/Leave.js';
import Attendance from '../models/Attendance.js';
import LeaveBalance from '../models/LeaveBalance.js';
import Notification from '../models/Notification.js';
import Payroll from '../models/Payroll.js';
import SalaryStructure from '../models/SalaryStructure.js';
import Department from '../models/Department.js';

// Permanently remove an employee and every record tied to them. This is a hard
// delete: leave history, attendance, payroll and salary rows are all wiped
// along with the employee document. Returns a per-collection summary of how
// many documents were removed so callers can log and verify the purge.
//
// `employee` must be a loaded Employee document (we read its _id and the
// email(s) used to route approvals to it).
export const cascadeDeleteEmployee = async (employee) => {
  const employeeId = employee._id;

  // Records owned by this employee.
  const [leaves, attendance, leaveBalances, notifications, payrolls, salaryStructures] =
    await Promise.all([
      Leave.deleteMany({ employee: employeeId }),
      Attendance.deleteMany({ employee: employeeId }),
      LeaveBalance.deleteMany({ employee: employeeId }),
      Notification.deleteMany({ recipient: employeeId }),
      Payroll.deleteMany({ employee: employeeId }),
      SalaryStructure.deleteMany({ employee: employeeId }),
    ]);

  // Drop any department-head assignment held by this account.
  const departmentHeads = await Department.updateMany(
    { heads: employeeId },
    { $pull: { heads: employeeId } }
  );

  // If this account was used to route approvals (its login/notification email
  // appears in other employees' headNotificationEmails), stop routing to it so
  // no one is left pointing at a deleted head.
  const routingEmails = [employee.email, employee.notificationEmail]
    .map((value) => String(value || '').toLowerCase())
    .filter(Boolean);
  let reroutedEmployees = { modifiedCount: 0 };
  if (routingEmails.length) {
    reroutedEmployees = await Employee.updateMany(
      { headNotificationEmails: { $in: routingEmails } },
      { $pull: { headNotificationEmails: { $in: routingEmails } } }
    );
  }

  // Finally the employee document itself.
  await employee.deleteOne();

  return {
    leaves: leaves.deletedCount,
    attendance: attendance.deletedCount,
    leaveBalances: leaveBalances.deletedCount,
    notifications: notifications.deletedCount,
    payrolls: payrolls.deletedCount,
    salaryStructures: salaryStructures.deletedCount,
    departmentHeadLinks: departmentHeads.modifiedCount,
    reroutedEmployees: reroutedEmployees.modifiedCount,
  };
};

// Count everything that a purge would remove, without deleting anything. Used
// by the verification script for a dry run and for before/after checks.
export const countEmployeeRecords = async (employee) => {
  const employeeId = employee._id;
  const routingEmails = [employee.email, employee.notificationEmail]
    .map((value) => String(value || '').toLowerCase())
    .filter(Boolean);

  const [leaves, attendance, leaveBalances, notifications, payrolls, salaryStructures, departmentHeadLinks, reroutedEmployees] =
    await Promise.all([
      Leave.countDocuments({ employee: employeeId }),
      Attendance.countDocuments({ employee: employeeId }),
      LeaveBalance.countDocuments({ employee: employeeId }),
      Notification.countDocuments({ recipient: employeeId }),
      Payroll.countDocuments({ employee: employeeId }),
      SalaryStructure.countDocuments({ employee: employeeId }),
      Department.countDocuments({ heads: employeeId }),
      routingEmails.length
        ? Employee.countDocuments({ headNotificationEmails: { $in: routingEmails } })
        : Promise.resolve(0),
    ]);

  return {
    leaves,
    attendance,
    leaveBalances,
    notifications,
    payrolls,
    salaryStructures,
    departmentHeadLinks,
    reroutedEmployees,
  };
};
