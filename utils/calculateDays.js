export const calculateDays = (startDate, endDate, holidays = []) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  if (isNaN(start) || isNaN(end) || end < start) {
    return 0;
  }

  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const dayOfWeek = current.getDay();
    // Sunday is the weekly off day. Saturdays and holidays count as leave days.
    const isWeeklyOff = dayOfWeek === 0;

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
