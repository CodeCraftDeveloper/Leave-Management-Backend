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

const router = express.Router();

router.use(protect, reviewerOnly);

router.get('/leaves/export', exportReviewQueue);
router.get('/leaves', getReviewQueue);
router.patch('/leaves/:id', actionLeave);
router.get('/team', getTeam);
router.patch('/employees/:id/role', headOnly, updateEmployeeRole);
router.get('/weekly-digest', headOnly, getWeeklyDigestPreview);
router.post('/weekly-digest/send', headOnly, sendWeeklyDigestNow);

export default router;
