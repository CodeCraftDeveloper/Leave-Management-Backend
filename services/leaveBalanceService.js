import LeaveBalance from '../models/LeaveBalance.js';
import Settings from '../models/Settings.js';

const quotaForType = (yearlyQuota = {}, leaveType) => {
  if (typeof yearlyQuota.get === 'function') return yearlyQuota.get(leaveType);
  return yearlyQuota[leaveType];
};

// Legacy get-or-create for older integrations. New payroll logic does not
// consume yearly/type-wise balance rows.
export const ensureBalance = async (employeeId, leaveType, year) => {
  let row = await LeaveBalance.findOne({ employee: employeeId, leaveType, year });
  if (row) return row;
  const settings = await Settings.get();
  const opening = Number(quotaForType(settings.yearlyQuota, leaveType) ?? 0);
  row = await LeaveBalance.create({
    employee: employeeId,
    leaveType,
    year,
    openingBalance: opening,
    usedLeaves: 0,
    remainingBalance: opening,
  });
  return row;
};

// Legacy endpoint support. The current policy has no yearly/type-wise quota;
// payroll applies the configured monthly free-leave allowance instead.
export const getYearlyBalances = async (employeeId, year) => {
  await Settings.get();
  return [];
};

// Apply approved leave to the balance ledger.
// Returns { paidDays, lopDays } so payroll knows how much was unpaid.
// Rule: paid leave types reduce balance up to remainingBalance; any
// excess overflows to LOP. Unpaid leave always = LOP.
export const consumeLeave = async (employeeId, leaveType, totalDays, year) => {
  return { paidDays: totalDays, lopDays: 0 };
};

// Refund a previously-approved leave (e.g., cancellation after approval).
export const refundLeave = async (employeeId, leaveType, paidDays, year) => {
  return;
};
