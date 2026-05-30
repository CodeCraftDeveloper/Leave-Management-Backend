import express from 'express';
import { protect, reviewerOnly, superAdminOnly, headOrSuperAdmin } from '../middleware/auth.js';
import {
  getReviewQueue,
  exportReviewQueue,
  getTeam,
  actionLeave,
  createEmployee,
  updateEmployeeRole,
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
  setDepartmentHead,
  setHeadsGroup,
} from '../controllers/departmentController.js';

const router = express.Router();

router.use(protect, reviewerOnly);

router.get('/leaves/export', exportReviewQueue);
router.get('/leaves', getReviewQueue);
router.patch('/leaves/:id', actionLeave);
router.get('/team', getTeam);
// Heads (and the super admin) can add brand-new employees to the global roster.
// Scoped heads are restricted to their own department(s) inside the controller.
router.post('/employees', headOrSuperAdmin, createEmployee);
// Global powers — reserved for the super admin since ordinary heads are now
// department-scoped.
router.patch('/employees/:id/role', superAdminOnly, updateEmployeeRole);
router.get('/weekly-digest', superAdminOnly, getWeeklyDigestPreview);
router.post('/weekly-digest/send', superAdminOnly, sendWeeklyDigestNow);

// Department management — list is scoped per reviewer (each sees the
// department(s) they head; super admin sees all). Mutations are open to heads,
// but the controllers restrict scoped heads to the departments they oversee.
router.get('/departments', listDepartments);
router.post('/departments', headOrSuperAdmin, createDepartment);
router.get('/departments/:id', headOrSuperAdmin, getDepartment);
router.patch('/departments/:id', headOrSuperAdmin, updateDepartment);
router.delete('/departments/:id', headOrSuperAdmin, deleteDepartment);
router.post('/departments/:id/members', headOrSuperAdmin, addMember);
router.delete('/departments/:id/members/:employeeId', headOrSuperAdmin, removeMember);
router.patch('/departments/:id/department-head', headOrSuperAdmin, setDepartmentHead);
router.patch('/departments/:id/heads-group', headOrSuperAdmin, setHeadsGroup);

export default router;
