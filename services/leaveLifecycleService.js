import Attendance from '../models/Attendance.js';
import { eachDayInRange, startOfDayIST } from '../utils/dateHelpers.js';

// Approval no longer deducts a yearly leave ledger — the 2-free-per-month
// rule is enforced at payroll generation time. We only stamp the days as
// ON_LEAVE so the monthly summary and admin daily-roster see them.
export const onLeaveApproved = async (leave, actorId) => {
  const empId = leave.employee._id || leave.employee;
  const days = eachDayInRange(leave.startDate, leave.endDate);
  for (const d of days) {
    const date = startOfDayIST(d);
    const existing = await Attendance.findOne({ employee: empId, date });
    if (existing && existing.checkIn) continue; // don't overwrite real presence
    const status = leave.isHalfDay ? 'HALF_DAY' : 'ON_LEAVE';
    if (existing) {
      existing.status = status;
      existing.remarks = `Approved ${leave.leaveType} leave`;
      existing.updatedBy = actorId;
      await existing.save();
    } else {
      await Attendance.create({
        employee: empId,
        date,
        status,
        remarks: `Approved ${leave.leaveType} leave`,
        createdBy: actorId,
      });
    }
  }
  return { stampedDays: days.length };
};

// Cancellation of an approved future leave: clear our stamps. No balance
// refund needed since balances are computed per month at payroll time.
export const onApprovedLeaveCancelled = async (leave) => {
  const empId = leave.employee._id || leave.employee;
  const days = eachDayInRange(leave.startDate, leave.endDate);
  for (const d of days) {
    const date = startOfDayIST(d);
    await Attendance.deleteOne({
      employee: empId,
      date,
      status: { $in: ['ON_LEAVE', 'HALF_DAY'] },
      checkIn: { $exists: false },
    });
  }
};
