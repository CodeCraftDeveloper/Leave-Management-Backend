import express from 'express';
import {
  applyLeave,
  getMyLeaves,
  getLeaveById,
  cancelLeave,
  getMySummary,
  getCalendarLeaves,
} from '../controllers/leaveController.js';
import { protect } from '../middleware/auth.js';
import upload from '../middleware/upload.js';

const router = express.Router();

router.use(protect);

router.post('/', upload.single('attachment'), applyLeave);
router.get('/mine', getMyLeaves);
router.get('/summary', getMySummary);
router.get('/calendar', getCalendarLeaves);
router.get('/:id', getLeaveById);
router.patch('/:id/cancel', cancelLeave);

export default router;
