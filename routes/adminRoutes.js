import express from 'express';
import {
  getDashboard,
  getAllLeaves,
  exportLeaves,
  updateLeaveStatus,
  getEmployees,
  createEmployee,
  getEmployeeDetail,
  updateEmployee,
  deleteEmployee,
  updateEmployeeWorkDetails,
  applyLeaveOnBehalf,
} from '../controllers/adminController.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();

router.use(protect, adminOnly);

router.get('/dashboard', getDashboard);
router.get('/leaves/export', exportLeaves);
router.get('/leaves', getAllLeaves);
router.post('/leaves', applyLeaveOnBehalf);
router.patch('/leaves/:id', updateLeaveStatus);
router.get('/employees', getEmployees);
router.post('/employees', createEmployee);
router.get('/employees/:id', getEmployeeDetail);
router.patch('/employees/:id', updateEmployee);
router.delete('/employees/:id', deleteEmployee);
router.patch('/employees/:id/work-details', updateEmployeeWorkDetails);

export default router;
