import express from 'express';
import {
  checkIn,
  checkOut,
  getToday,
  getHistory,
  getMonthlySummary,
  upsertManualAttendance,
  getDailyAttendance,
} from '../controllers/attendanceController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.post('/check-in', checkIn);
router.post('/check-out', checkOut);
router.get('/today', getToday);
router.get('/history', getHistory);
router.get('/summary', getMonthlySummary);

// Admin / HR endpoints
router.get('/daily', getDailyAttendance);
router.put('/manual', upsertManualAttendance);

export default router;
