import asyncHandler from 'express-async-handler';
import Attendance from '../models/Attendance.js';
import Employee from '../models/Employee.js';
import { isWithinOffice } from '../utils/geofence.js';
import { startOfDayIST, monthRange } from '../utils/dateHelpers.js';
import { deriveAttendanceMetrics, loadSettings } from '../services/attendanceService.js';

function validateCoords(body) {
  const lat = parseFloat(body.latitude);
  const lng = parseFloat(body.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

// ─── Check-In ────────────────────────────────────────────
// POST /api/attendance/check-in
export const checkIn = asyncHandler(async (req, res) => {
  const coords = validateCoords(req.body);
  if (!coords) {
    res.status(400);
    throw new Error('Valid latitude and longitude are required');
  }

  const geo = isWithinOffice(coords.latitude, coords.longitude);
  if (!geo.allowed) {
    res.status(403);
    throw new Error(
      `You must be at the office to check in. You are approximately ${geo.distance}m away (allowed radius: ${geo.radius}m).`
    );
  }

  const date = startOfDayIST();
  const existing = await Attendance.findOne({ employee: req.user._id, date });

  if (existing) {
    if (['checked-in', 'PRESENT', 'LATE', 'HALF_DAY'].includes(existing.status) && !existing.checkOut) {
      res.status(400);
      throw new Error('You have already checked in today');
    }
    if (existing.checkOut) {
      res.status(400);
      throw new Error('You have already completed attendance for today');
    }
  }

  const settings = await loadSettings();
  const checkInTime = new Date();
  const metrics = deriveAttendanceMetrics(checkInTime, null, settings);

  const record = await Attendance.create({
    employee: req.user._id,
    date,
    checkIn: { time: checkInTime, latitude: coords.latitude, longitude: coords.longitude },
    lateMinutes: metrics.lateMinutes,
    status: 'checked-in',
    createdBy: req.user._id,
  });

  res.status(201).json(record);
});

// ─── Check-Out ───────────────────────────────────────────
// POST /api/attendance/check-out
export const checkOut = asyncHandler(async (req, res) => {
  const coords = validateCoords(req.body);
  if (!coords) {
    res.status(400);
    throw new Error('Valid latitude and longitude are required');
  }

  const geo = isWithinOffice(coords.latitude, coords.longitude);
  if (!geo.allowed) {
    res.status(403);
    throw new Error(
      `You must be at the office to check out. You are approximately ${geo.distance}m away (allowed radius: ${geo.radius}m).`
    );
  }

  const date = startOfDayIST();
  const record = await Attendance.findOne({ employee: req.user._id, date });

  if (!record) {
    res.status(400);
    throw new Error('You have not checked in today');
  }
  if (record.checkOut) {
    res.status(400);
    throw new Error('You have already checked out today');
  }

  const checkInTime = new Date(record.checkIn.time);
  const checkOutTime = new Date();
  if (checkOutTime <= checkInTime) {
    res.status(400);
    throw new Error('Check-out must be after check-in');
  }

  const settings = await loadSettings();
  const metrics = deriveAttendanceMetrics(checkInTime, checkOutTime, settings);

  record.checkOut = { time: checkOutTime, latitude: coords.latitude, longitude: coords.longitude };
  record.totalHours = metrics.totalHours;
  record.workHours = metrics.workHours;
  record.lateMinutes = metrics.lateMinutes;
  record.overtimeHours = metrics.overtimeHours;
  record.status = metrics.status;
  record.updatedBy = req.user._id;
  await record.save();

  res.json(record);
});

// ─── Today ───────────────────────────────────────────────
export const getToday = asyncHandler(async (req, res) => {
  const date = startOfDayIST();
  const record = await Attendance.findOne({ employee: req.user._id, date });
  res.json(record || null);
});

// ─── History ─────────────────────────────────────────────
export const getHistory = asyncHandler(async (req, res) => {
  const { days = 30, page = 1, limit = 20 } = req.query;
  const since = new Date();
  since.setDate(since.getDate() - Number(days));
  since.setHours(0, 0, 0, 0);

  const filter = { employee: req.user._id, date: { $gte: since } };
  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    Attendance.find(filter).sort({ date: -1 }).skip(skip).limit(Number(limit)),
    Attendance.countDocuments(filter),
  ]);

  res.json({ items, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
});

// ─── Monthly Summary ─────────────────────────────────────
// GET /api/attendance/summary?month=11&year=2026  (employee = self unless admin/hr passes employeeId)
export const getMonthlySummary = asyncHandler(async (req, res) => {
  const month = Number(req.query.month) || new Date().getMonth() + 1;
  const year = Number(req.query.year) || new Date().getFullYear();
  let employeeId = req.user._id;
  if (req.query.employeeId && ['head', 'hr'].includes(req.user.role)) {
    employeeId = req.query.employeeId;
  }
  const { start, end } = monthRange(year, month);
  const records = await Attendance.find({
    employee: employeeId,
    date: { $gte: start, $lte: end },
  }).sort({ date: 1 });

  const totals = records.reduce(
    (acc, r) => {
      acc.workHours += Number(r.workHours || 0);
      acc.overtimeHours += Number(r.overtimeHours || 0);
      acc.lateMinutes += Number(r.lateMinutes || 0);
      acc.byStatus[r.status] = (acc.byStatus[r.status] || 0) + 1;
      return acc;
    },
    { workHours: 0, overtimeHours: 0, lateMinutes: 0, byStatus: {} }
  );

  res.json({ month, year, records, totals });
});

// ─── Admin/HR manual entry/update ────────────────────────
// PUT /api/attendance/manual  body: { employeeId, date, checkIn, checkOut, status, remarks }
export const upsertManualAttendance = asyncHandler(async (req, res) => {
  if (!['head', 'hr'].includes(req.user.role)) {
    res.status(403);
    throw new Error('Head/HR access required');
  }
  const { employeeId, date, checkIn, checkOut, status, remarks } = req.body;
  if (!employeeId || !date) {
    res.status(400);
    throw new Error('employeeId and date are required');
  }
  const employee = await Employee.findById(employeeId);
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }
  const day = startOfDayIST(new Date(date));
  const settings = await loadSettings();

  const checkInTime = checkIn ? new Date(checkIn) : null;
  const checkOutTime = checkOut ? new Date(checkOut) : null;
  if (checkInTime && checkOutTime && checkOutTime <= checkInTime) {
    res.status(400);
    throw new Error('Check-out must be after check-in');
  }
  const metrics = deriveAttendanceMetrics(checkInTime, checkOutTime, settings);

  const update = {
    employee: employeeId,
    date: day,
    status: status || metrics.status,
    workHours: metrics.workHours,
    totalHours: metrics.totalHours,
    lateMinutes: metrics.lateMinutes,
    overtimeHours: metrics.overtimeHours,
    remarks: remarks || '',
    updatedBy: req.user._id,
  };
  if (checkInTime) update.checkIn = { time: checkInTime, latitude: 0, longitude: 0 };
  if (checkOutTime) update.checkOut = { time: checkOutTime, latitude: 0, longitude: 0 };

  const record = await Attendance.findOneAndUpdate(
    { employee: employeeId, date: day },
    { $set: update, $setOnInsert: { createdBy: req.user._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.json(record);
});

// ─── Daily roster (admin/hr) ─────────────────────────────
// GET /api/attendance/daily?date=2026-05-27
export const getDailyAttendance = asyncHandler(async (req, res) => {
  if (!['head', 'hr'].includes(req.user.role)) {
    res.status(403);
    throw new Error('Head/HR access required');
  }
  const date = req.query.date ? startOfDayIST(new Date(req.query.date)) : startOfDayIST();
  const records = await Attendance.find({ date }).populate('employee', 'name employeeId department');
  res.json({ date, records, count: records.length });
});
