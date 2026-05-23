import express from 'express';
import { updateProfile, changePassword } from '../controllers/employeeController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.patch('/profile', updateProfile);
router.patch('/password', changePassword);

export default router;
