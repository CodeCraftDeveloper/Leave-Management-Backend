import express from 'express';
import { employeeDashboard, adminDashboard } from '../controllers/dashboardController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.get('/employee', employeeDashboard);
router.get('/admin', adminDashboard);

export default router;
