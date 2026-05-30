import express from 'express';
import {
  previewPayroll,
  getLiveEarnings,
  generateOne,
  generateBulk,
  listPayrolls,
  getPayroll,
  markPaid,
  cancelPayroll,
} from '../controllers/payrollController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.get('/preview', previewPayroll);
router.get('/live-earnings', getLiveEarnings);
router.get('/', listPayrolls);
router.post('/generate', generateOne);
router.post('/generate-bulk', generateBulk);
router.get('/:id', getPayroll);
router.patch('/:id/pay', markPaid);
router.patch('/:id/cancel', cancelPayroll);

export default router;
