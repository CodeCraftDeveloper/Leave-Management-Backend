import express from 'express';
import { protect, reviewerOnly, superAdminOnly, headOrSuperAdmin } from '../middleware/auth.js';
import {
  getReviewQueue,
  exportReviewQueue,
  getTeam,
  actionLeave,
  cancelLeave,
  createEmployee,
  getWeeklyDigestPreview,
  sendWeeklyDigestNow,
} from '../controllers/manageController.js';
import {
  listDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  addMember,
  removeMember,
  setHeadsGroup,
} from '../controllers/departmentController.js';

const router = express.Router();

router.use(protect, reviewerOnly);

router.get('/leaves/export', exportReviewQueue);
router.get('/leaves', getReviewQueue);
router.patch('/leaves/:id/cancel', cancelLeave);
router.patch('/leaves/:id', actionLeave);
router.get('/team', getTeam);
// Heads (and the super admin) can add brand-new employees to the global roster.
// Scoped heads are restricted to their own department(s) inside the controller.
router.post('/employees', headOrSuperAdmin, createEmployee);
// Global powers — reserved for the super admin since ordinary heads are now
// department-scoped.
router.get('/weekly-digest', superAdminOnly, getWeeklyDigestPreview);
router.post('/weekly-digest/send', superAdminOnly, sendWeeklyDigestNow);

// Department management — list is scoped per reviewer (each sees the
// department(s) they head; super admin sees all). Mutations are open to heads,
// but the controllers restrict scoped heads to the departments they oversee.
router.get('/departments', listDepartments);
router.post('/departments', superAdminOnly, createDepartment);
router.get('/departments/:id', headOrSuperAdmin, getDepartment);
router.patch('/departments/:id', superAdminOnly, updateDepartment);
router.delete('/departments/:id', superAdminOnly, deleteDepartment);
router.post('/departments/:id/members', superAdminOnly, addMember);
router.delete('/departments/:id/members/:employeeId', superAdminOnly, removeMember);
router.patch('/departments/:id/heads-group', superAdminOnly, setHeadsGroup);

export default router;
