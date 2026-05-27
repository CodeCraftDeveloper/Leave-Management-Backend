import express from 'express';
import { getStructure, upsertStructure } from '../controllers/salaryStructureController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.get('/:employeeId', getStructure);
router.put('/:employeeId', upsertStructure);

export default router;
