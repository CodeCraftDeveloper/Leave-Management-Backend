import asyncHandler from 'express-async-handler';
import { getYearlyBalances } from '../services/leaveBalanceService.js';

const adminOrHR = (user) => ['head', 'hr'].includes(user.role);

// GET /api/leave-balances/:employeeId?year=2026   (admin/hr OR self)
export const getBalances = asyncHandler(async (req, res) => {
  const employeeId = req.params.employeeId;
  if (!adminOrHR(req.user) && String(employeeId) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized');
  }
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = await getYearlyBalances(employeeId, year);
  res.json({ employeeId, year, balances: rows });
});

// GET /api/leave-balances/me
export const getMyBalances = asyncHandler(async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = await getYearlyBalances(req.user._id, year);
  res.json({ employeeId: req.user._id, year, balances: rows });
});
