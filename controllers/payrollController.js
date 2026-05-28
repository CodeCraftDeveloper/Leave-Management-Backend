import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Payroll from '../models/Payroll.js';
import Employee from '../models/Employee.js';
import {
  generatePayrollForEmployee,
  computePayroll,
  buildPayslip,
} from '../services/payrollService.js';

const parseMonthYear = (q) => {
  const month = Number(q.month) || new Date().getMonth() + 1;
  const year = Number(q.year) || new Date().getFullYear();
  if (month < 1 || month > 12) throw Object.assign(new Error('Invalid month'), { statusCode: 400 });
  if (year < 2000 || year > 2100) throw Object.assign(new Error('Invalid year'), { statusCode: 400 });
  return { month, year };
};

// Preview payroll numbers WITHOUT writing to DB. Useful for "before generate".
// GET /api/payroll/preview?employeeId=&month=&year=
export const previewPayroll = asyncHandler(async (req, res) => {
  const { month, year } = parseMonthYear(req.query);
  const employeeId = req.query.employeeId || req.user._id;
  if (!['head', 'hr'].includes(req.user.role) && String(employeeId) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized');
  }
  const employee = await Employee.findById(employeeId);
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }
  const data = await computePayroll(employee, month, year);
  res.json({ employeeId, month, year, ...data });
});

// Generate (or regenerate) a single employee's payroll for a month.
// POST /api/payroll/generate
//   body: { employeeId, month, year, monthlySalary?, freeLeaves?, force?, remarks? }
export const generateOne = asyncHandler(async (req, res) => {
  if (!['head', 'hr'].includes(req.user.role)) {
    res.status(403);
    throw new Error('Head/HR access required');
  }
  const { employeeId, month, year } = req.body;
  if (!employeeId || !month || !year) {
    res.status(400);
    throw new Error('employeeId, month, year are required');
  }
  const payroll = await generatePayrollForEmployee(employeeId, Number(month), Number(year), req.body, req.user._id);
  res.status(201).json(payroll);
});

// Bulk: generate payroll for ALL active employees for a month.
// POST /api/payroll/generate-bulk  body: { month, year, force? }
export const generateBulk = asyncHandler(async (req, res) => {
  if (!['head', 'hr'].includes(req.user.role)) {
    res.status(403);
    throw new Error('Head/HR access required');
  }
  const { month, year } = req.body;
  if (!month || !year) {
    res.status(400);
    throw new Error('month, year required');
  }
  const employees = await Employee.find({ active: true, role: { $in: ['employee', 'hr'] } });
  const results = { success: [], failed: [] };
  for (const emp of employees) {
    try {
      const p = await generatePayrollForEmployee(emp._id, Number(month), Number(year), { force: !!req.body.force }, req.user._id);
      results.success.push({
        employeeId: emp._id,
        payrollId: p._id,
        netSalary: p.netSalary,
        otSalary: p.otSalary,
        totalPayable: p.totalPayable,
        otCreditDate: p.otCreditDate,
      });
    } catch (err) {
      results.failed.push({ employeeId: emp._id, error: err.message });
    }
  }
  res.json({ month: Number(month), year: Number(year), ...results });
});

// List payrolls by month/year (admin/hr) or by self (employee).
// GET /api/payroll?month=&year=&employeeId=
export const listPayrolls = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.month) filter.month = Number(req.query.month);
  if (req.query.year) filter.year = Number(req.query.year);

  if (['head', 'hr'].includes(req.user.role)) {
    if (req.query.employeeId) filter.employee = req.query.employeeId;
  } else {
    filter.employee = req.user._id;
  }

  const items = await Payroll.find(filter)
    .sort({ year: -1, month: -1 })
    .populate('employee', 'name employeeId department designation');
  res.json({ items, total: items.length });
});

// GET /api/payroll/:id
export const getPayroll = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400);
    throw new Error('Invalid id');
  }
  const payroll = await Payroll.findById(req.params.id)
    .populate('employee', 'name employeeId department designation email');
  if (!payroll) {
    res.status(404);
    throw new Error('Payroll not found');
  }
  if (!['head', 'hr'].includes(req.user.role) && payroll.employee._id.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized');
  }
  res.json(payroll);
});

// Mark a payroll row as PAID.
// PATCH /api/payroll/:id/pay
export const markPaid = asyncHandler(async (req, res) => {
  if (!['head', 'hr'].includes(req.user.role)) {
    res.status(403);
    throw new Error('Head/HR access required');
  }
  const payroll = await Payroll.findById(req.params.id);
  if (!payroll) {
    res.status(404);
    throw new Error('Payroll not found');
  }
  if (payroll.status === 'PAID') {
    res.status(400);
    throw new Error('Already marked as paid');
  }
  payroll.status = 'PAID';
  payroll.paidAt = new Date();
  payroll.paidBy = req.user._id;
  await payroll.save();
  res.json(payroll);
});

// PATCH /api/payroll/:id/cancel
export const cancelPayroll = asyncHandler(async (req, res) => {
  if (!['head', 'hr'].includes(req.user.role)) {
    res.status(403);
    throw new Error('Head/HR access required');
  }
  const payroll = await Payroll.findById(req.params.id);
  if (!payroll) {
    res.status(404);
    throw new Error('Payroll not found');
  }
  payroll.status = 'CANCELLED';
  payroll.remarks = req.body.reason || payroll.remarks;
  await payroll.save();
  res.json(payroll);
});

// GET /api/payslips/:id
export const getPayslip = asyncHandler(async (req, res) => {
  const payroll = await Payroll.findById(req.params.id);
  if (!payroll) {
    res.status(404);
    throw new Error('Payroll not found');
  }
  if (!['head', 'hr'].includes(req.user.role) && payroll.employee.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized');
  }
  const payslip = await buildPayslip(payroll);
  res.json(payslip);
});

// GET /api/payslips/latest  (employee self)
export const getLatestPayslip = asyncHandler(async (req, res) => {
  const employeeId = req.query.employeeId || req.user._id;
  if (!['head', 'hr'].includes(req.user.role) && String(employeeId) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized');
  }
  const payroll = await Payroll.findOne({ employee: employeeId }).sort({ year: -1, month: -1 });
  if (!payroll) return res.json(null);
  res.json(await buildPayslip(payroll));
});
