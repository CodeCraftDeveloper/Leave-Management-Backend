import { effectiveWeekOffDaysForEmployee } from './leavePolicy.js';

export const calculateDays = (startDate, endDate, holidays = [], options = {}) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  if (isNaN(start) || isNaN(end) || end < start) {
    return 0;
  }

  let count = 0;
  const current = new Date(start);
  const weekOffDays = new Set(
    effectiveWeekOffDaysForEmployee(options.employee || options.employeeId, options.weekOffDays)
  );

  while (current <= end) {
    const dayOfWeek = current.getDay();
    const isWeeklyOff = weekOffDays.has(dayOfWeek);

    if (!isWeeklyOff) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
};

export const datesOverlap = (aStart, aEnd, bStart, bEnd) => {
  return new Date(aStart) <= new Date(bEnd) && new Date(bStart) <= new Date(aEnd);
};
