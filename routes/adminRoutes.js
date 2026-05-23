import express from 'express';
import {
  getDashboard,
  getAllLeaves,
  updateLeaveStatus,
  getEmployees,
  getEmployeeDetail,
  updateEmployeeWorkDetails,
  applyLeaveOnBehalf,
} from '../controllers/adminController.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();

router.use(protect, adminOnly);

router.get('/dashboard', getDashboard);
router.get('/leaves', getAllLeaves);
router.post('/leaves', applyLeaveOnBehalf);
router.patch('/leaves/:id', updateLeaveStatus);
router.get('/employees', getEmployees);
router.get('/employees/:id', getEmployeeDetail);
router.patch('/employees/:id/work-details', updateEmployeeWorkDetails);

export default router;
