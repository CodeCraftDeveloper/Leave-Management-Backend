import express from 'express';
import { getHolidays, createHoliday, deleteHoliday } from '../controllers/holidayController.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();

router.get('/', protect, getHolidays);
router.post('/', protect, adminOnly, createHoliday);
router.delete('/:id', protect, adminOnly, deleteHoliday);

export default router;
