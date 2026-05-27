import Settings from '../models/Settings.js';
import { hoursBetween } from '../utils/dateHelpers.js';

/**
 * Derive basic attendance metrics from check-in / check-out times.
 * No late tracking, no half-day, no hourly overtime — Sunday work is the
 * only "overtime" and that's evaluated at payroll time.
 */
export const deriveAttendanceMetrics = (checkInTime, checkOutTime /*, settings */) => {
  if (!checkInTime) {
    return { workHours: 0, totalHours: 0, lateMinutes: 0, overtimeHours: 0, status: 'ABSENT' };
  }
  if (!checkOutTime) {
    return { workHours: 0, totalHours: 0, lateMinutes: 0, overtimeHours: 0, status: 'checked-in' };
  }
  const workHours = hoursBetween(checkInTime, checkOutTime);
  return {
    workHours,
    totalHours: workHours,
    lateMinutes: 0,
    overtimeHours: 0,
    status: 'PRESENT',
  };
};

export const loadSettings = () => Settings.get();
