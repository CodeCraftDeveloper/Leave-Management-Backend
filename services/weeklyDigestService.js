import cron from 'node-cron';
import Employee from '../models/Employee.js';
import Leave from '../models/Leave.js';
import { sendWeeklyHeadDigestEmail } from './emailService.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const getWeekWindow = (referenceDate = new Date()) => {
  const start = new Date(referenceDate);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diffToMonday);

  const end = new Date(start.getTime() + (7 * DAY_MS) - 1);
  return { weekStart: start, weekEnd: end };
};

export const getApprovedLeavesForWeek = async (referenceDate = new Date()) => {
  const { weekStart, weekEnd } = getWeekWindow(referenceDate);
  const leaves = await Leave.find({
    status: 'approved',
    startDate: { $lte: weekEnd },
    endDate: { $gte: weekStart },
    $or: [{ digestSentAt: null }, { digestSentAt: { $exists: false } }],
  })
    .sort({ startDate: 1 })
    .populate('employee', 'name employeeId department email role');

  return { weekStart, weekEnd, leaves };
};

export const sendWeeklyHeadDigest = async (referenceDate = new Date()) => {
  const [{ weekStart, weekEnd, leaves }, heads] = await Promise.all([
    getApprovedLeavesForWeek(referenceDate),
    Employee.find({ role: 'head', active: true, email: { $exists: true, $ne: '' } })
      .select('name employeeId email')
      .lean(),
  ]);

  const results = await Promise.all(
    heads.map((head) => sendWeeklyHeadDigestEmail({ head, weekStart, weekEnd, leaves }))
  );

  if (leaves.length && heads.length) {
    await Leave.updateMany(
      { _id: { $in: leaves.map((l) => l._id) } },
      { $set: { digestSentAt: new Date() } }
    );
  }

  return {
    weekStart,
    weekEnd,
    heads: heads.length,
    leaveCount: leaves.length,
    results,
  };
};

export const startWeeklyDigestScheduler = () => {
  if (process.env.DISABLE_WEEKLY_DIGEST === 'true') {
    console.log('[WeeklyDigest] Scheduler disabled by DISABLE_WEEKLY_DIGEST=true');
    return null;
  }

  return cron.schedule(
    '0 8 * * 1',
    async () => {
      try {
        const result = await sendWeeklyHeadDigest();
        console.log(`[WeeklyDigest] Sent to ${result.heads} head(s), ${result.leaveCount} approved leave(s).`);
      } catch (error) {
        console.error('[WeeklyDigest] Failed:', error.message);
      }
    },
    { timezone: 'Asia/Kolkata' }
  );
};
