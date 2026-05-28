import express from 'express';
import {
  login,
  registerEmployee,
  me,
  setEmail,
  verifyEmail,
  resendVerification,
} from '../controllers/authController.js';
import { protect, headOnly } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', login);
router.post('/admin/login', login); // legacy URL - kept for back-compat
router.post('/register', protect, headOnly, registerEmployee);
router.get('/me', protect, me);
router.put('/email', protect, setEmail);
router.post('/email/verify', protect, verifyEmail);
router.post('/email/resend', protect, resendVerification);

export default router;
