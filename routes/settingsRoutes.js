import express from 'express';
import { getSettings, updateSettings } from '../controllers/settingsController.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.get('/', getSettings);
router.patch('/', adminOnly, updateSettings);

export default router;
