import express from 'express';
import { getBalances, getMyBalances } from '../controllers/leaveBalanceController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.get('/me', getMyBalances);
router.get('/:employeeId', getBalances);

export default router;
