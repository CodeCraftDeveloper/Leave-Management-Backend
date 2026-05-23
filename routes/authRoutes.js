import express from 'express';
import {
  login,
  registerEmployee,
  me,
  setEmail,
} from '../controllers/authController.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', login);
router.post('/admin/login', login);
router.post('/register', protect, adminOnly, registerEmployee);
router.get('/me', protect, me);
router.put('/email', protect, setEmail);

export default router;
