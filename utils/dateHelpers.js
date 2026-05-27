// Reusable date helpers. All payroll/attendance date math should funnel
// through here so we don't sprinkle timezone-sensitive code everywhere.

const IST_OFFSET_MS = 330 * 60 * 1000;

export const startOfDayIST = (input = new Date()) => {
  const d = new Date(input);
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
};

export const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

export const monthRange = (year, month) => {
  // month is 1-based (1 = January)
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month - 1, daysInMonth(year, month), 23, 59, 59, 999));
  return { start, end };
};

export const parseTimeHHMM = (hhmm, baseDate = new Date()) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  const d = new Date(baseDate);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
};

export const diffMinutes = (a, b) => Math.max(0, Math.round((a - b) / 60000));

export const hoursBetween = (start, end) =>
  Math.max(0, Math.round(((end - start) / 3600000) * 100) / 100);

export const isSameYMD = (a, b) => {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
};

export const eachDayInRange = (start, end) => {
  const days = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const stop = new Date(end);
  stop.setHours(0, 0, 0, 0);
  while (cur <= stop) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
};
