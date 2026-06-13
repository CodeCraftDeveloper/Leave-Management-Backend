export const SUNDAY_OFF_EMPLOYEE_IDS = Object.freeze([
  'H694',
  'H2',
  'H4',
  'H336',
  'H34',
  'H482',
  'H532',
  'H317',
  'H545',
  'H704',
  'H495',
  'H616',
  'H624',
  'H641',
  'H666',
  'H386',
  'H602',
  'H689',
]);

export const normalizeEmployeeId = (employeeOrId) => {
  if (!employeeOrId) return '';
  if (typeof employeeOrId === 'string') return employeeOrId.trim().toUpperCase();
  return String(employeeOrId.employeeId || '').trim().toUpperCase();
};

export const hasSundayOff = (employeeOrId) =>
  SUNDAY_OFF_EMPLOYEE_IDS.includes(normalizeEmployeeId(employeeOrId));

export const effectiveWeekOffDaysForEmployee = (employeeOrId, configuredWeekOffDays = []) => {
  const days = new Set(
    (Array.isArray(configuredWeekOffDays) ? configuredWeekOffDays : [])
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  );

  days.delete(0);
  if (hasSundayOff(employeeOrId)) days.add(0);

  return [...days].sort((a, b) => a - b);
};
