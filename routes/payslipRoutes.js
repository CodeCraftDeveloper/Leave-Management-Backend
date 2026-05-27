import express from 'express';
import { getPayslip, getLatestPayslip } from '../controllers/payrollController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.get('/latest', getLatestPayslip);
router.get('/:id', getPayslip);

export default router;
