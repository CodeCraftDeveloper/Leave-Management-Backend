import express from 'express';
import {
  getDashboard,
  getAllLeaves,
  exportLeaves,
  updateLeaveStatus,
  getEmployees,
  getApprovalHeads,
  createEmployee,
  getEmployeeDetail,
  updateEmployee,
  deleteEmployee,
  updateEmployeeWorkDetails,
  applyLeaveOnBehalf,
  downloadImportTemplate,
  importEmployees,
} from '../controllers/adminController.js';
import { protect, adminOnly } from '../middleware/auth.js';
import { importUpload } from '../middleware/uploadSpreadsheet.js';

const router = express.Router();

router.use(protect, adminOnly);

router.get('/dashboard', getDashboard);
router.get('/leaves/export', exportLeaves);
router.get('/leaves', getAllLeaves);
router.post('/leaves', applyLeaveOnBehalf);
router.patch('/leaves/:id', updateLeaveStatus);
router.get('/employees', getEmployees);
router.get('/heads', getApprovalHeads);
// Bulk import — registered before the `/employees/:id` param routes so the
// literal path segments are matched first.
router.get('/employees/import/template', downloadImportTemplate);
router.post('/employees/import', importUpload, importEmployees);
router.post('/employees', createEmployee);
router.get('/employees/:id', getEmployeeDetail);
router.patch('/employees/:id', updateEmployee);
router.delete('/employees/:id', deleteEmployee);
router.patch('/employees/:id/work-details', updateEmployeeWorkDetails);

export default router;
