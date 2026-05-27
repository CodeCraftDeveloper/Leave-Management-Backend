import Employee from '../models/Employee.js';
import Leave from '../models/Leave.js';

const HALF_DAY_SESSIONS = ['first_half', 'second_half'];

const startOfDay = (value) => {
  const day = new Date(value);
  day.setHours(0, 0, 0, 0);
  return day;
};

const formatDay = (value) => {
  const day = startOfDay(value);
  const year = day.getFullYear();
  const month = String(day.getMonth() + 1).padStart(2, '0');
  const date = String(day.getDate()).padStart(2, '0');
  return `${year}-${month}-${date}`;
};

const getMinimumOnDuty = () => {
  const configured = Number.parseInt(process.env.MIN_DEPARTMENT_STAFF_ON_DUTY || '1', 10);
  return Number.isFinite(configured) && configured >= 0 ? configured : 1;
};

const sessionsForLeave = ({ isHalfDay, halfDaySession }) => (
  isHalfDay ? [halfDaySession] : HALF_DAY_SESSIONS
);

const coversDate = (leave, date) => {
  const start = startOfDay(leave.startDate);
  const end = startOfDay(leave.endDate);
  return start <= date && date <= end;
};

const coversSession = (leave, session) => (
  !leave.isHalfDay || leave.halfDaySession === session
);

const sessionLabel = (session) => (
  session === 'first_half' ? 'Morning' : 'Afternoon'
);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const assessDepartmentStaffing = async ({
  employee,
  startDate,
  endDate,
  isHalfDay = false,
  halfDaySession = '',
  excludeLeaveId,
}) => {
  const department = employee.department || 'General';
  const minimumOnDuty = getMinimumOnDuty();
  const activeEmployees = await Employee.find({
    role: 'employee',
    active: true,
    department: { $regex: `^${escapeRegex(department)}$`, $options: 'i' },
  }).select('_id name employeeId');

  const employeeIds = activeEmployees.map((member) => member._id);
  const approvedFilter = {
    status: 'approved',
    employee: { $in: employeeIds, $ne: employee._id },
    startDate: { $lte: startOfDay(endDate) },
    endDate: { $gte: startOfDay(startDate) },
  };
  if (excludeLeaveId) approvedFilter._id = { $ne: excludeLeaveId };

  const approvedLeaves = await Leave.find(approvedFilter).populate('employee', 'name employeeId department');
  const requestedSessions = sessionsForLeave({ isHalfDay, halfDaySession });
  const conflicts = [];
  const violations = [];

  for (
    let date = startOfDay(startDate), end = startOfDay(endDate);
    date <= end;
    date.setDate(date.getDate() + 1)
  ) {
    if (date.getDay() === 0) continue;

    for (const session of requestedSessions) {
      const employeesAway = new Map();
      approvedLeaves
        .filter((leave) => coversDate(leave, date) && coversSession(leave, session))
        .forEach((leave) => {
          const member = leave.employee;
          if (member?._id) employeesAway.set(String(member._id), member);
        });

      const absentCount = employeesAway.size + 1;
      const availableStaff = Math.max(activeEmployees.length - absentCount, 0);
      const summary = {
        date: formatDay(date),
        session,
        sessionLabel: sessionLabel(session),
        currentlyAway: [...employeesAway.values()].map((member) => ({
          id: member._id,
          name: member.name,
          employeeId: member.employeeId,
        })),
        absentCount,
        availableStaff,
      };

      if (employeesAway.size > 0) conflicts.push(summary);
      if (availableStaff < minimumOnDuty) violations.push(summary);
    }
  }

  return {
    department,
    totalActiveStaff: activeEmployees.length,
    minimumOnDuty,
    hasConcurrentLeave: conflicts.length > 0,
    conflicts,
    violations,
    blocked: violations.length > 0,
  };
};
