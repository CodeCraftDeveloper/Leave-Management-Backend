export const calculateDays = (startDate, endDate, holidays = []) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  if (isNaN(start) || isNaN(end) || end < start) {
    return 0;
  }

  // Convert holidays array to a Set of time values (in ms) for O(1) lookup
  const holidayTimes = new Set(
    holidays.map((h) => {
      const d = new Date(h.date || h);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })
  );

  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const dayOfWeek = current.getDay();
    // 0 is Sunday, 6 is Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = holidayTimes.has(current.getTime());

    if (!isWeekend && !isHoliday) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
};

export const datesOverlap = (aStart, aEnd, bStart, bEnd) => {
  return new Date(aStart) <= new Date(bEnd) && new Date(bStart) <= new Date(aEnd);
};

