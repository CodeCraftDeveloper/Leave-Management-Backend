import express from 'express';
import { protect, reviewerOnly, superAdminOnly } from '../middleware/auth.js';
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
// Global powers — reserved for the super admin since ordinary heads are now
// department-scoped.
router.patch('/employees/:id/role', superAdminOnly, updateEmployeeRole);
router.get('/weekly-digest', superAdminOnly, getWeeklyDigestPreview);
router.post('/weekly-digest/send', superAdminOnly, sendWeeklyDigestNow);

// Department management — list is scoped per reviewer (each sees the
// department(s) they head; super admin sees all); mutations are super-admin-only.
router.get('/departments', listDepartments);
router.post('/departments', superAdminOnly, createDepartment);
router.patch('/departments/:id', superAdminOnly, updateDepartment);
router.delete('/departments/:id', superAdminOnly, deleteDepartment);

export default router;
