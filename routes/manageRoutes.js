import express from 'express';
import { protect, reviewerOnly, headOnly } from '../middleware/auth.js';
import {
  getReviewQueue,
  exportReviewQueue,
  getTeam,
  actionLeave,
  updateEmployeeRole,
  getWeeklyDigestPreview,
  sendWeeklyDigestNow,
} from '../controllers/manageController.js';
import {
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from '../controllers/departmentController.js';

const router = express.Router();

router.use(protect, reviewerOnly);

router.get('/leaves/export', exportReviewQueue);
router.get('/leaves', getReviewQueue);
router.patch('/leaves/:id', actionLeave);
router.get('/team', getTeam);
router.patch('/employees/:id/role', headOnly, updateEmployeeRole);
router.get('/weekly-digest', headOnly, getWeeklyDigestPreview);
router.post('/weekly-digest/send', headOnly, sendWeeklyDigestNow);

// Department management — list is open to any reviewer (read-only) so
// dept_heads can see their own; mutations are head-only.
router.get('/departments', listDepartments);
router.post('/departments', headOnly, createDepartment);
router.patch('/departments/:id', headOnly, updateDepartment);
router.delete('/departments/:id', headOnly, deleteDepartment);

export default router;
