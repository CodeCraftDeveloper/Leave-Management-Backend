import asyncHandler from 'express-async-handler';
import SalaryStructure from '../models/SalaryStructure.js';
import Employee from '../models/Employee.js';

const adminOrHR = (user) => ['head', 'hr'].includes(user.role);

// GET /api/salary-structures/:employeeId   (admin/hr OR self)
export const getStructure = asyncHandler(async (req, res) => {
  const employeeId = req.params.employeeId;
  if (!adminOrHR(req.user) && String(employeeId) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized');
  }
  const structure = await SalaryStructure.findOne({ employee: employeeId });
  res.json(structure || null);
});

// PUT /api/salary-structures/:employeeId  (admin/hr only) — upsert
export const upsertStructure = asyncHandler(async (req, res) => {
  if (!adminOrHR(req.user)) {
    res.status(403);
    throw new Error('Head/HR access required');
  }
  const employee = await Employee.findById(req.params.employeeId);
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }
  const numeric = ['monthlySalary', 'basicSalary', 'hra', 'conveyanceAllowance', 'medicalAllowance', 'specialAllowance', 'pfAmount', 'professionalTax', 'tds', 'otherDeductions'];
  const update = {};
  for (const f of numeric) {
    if (req.body[f] !== undefined) {
      const v = Number(req.body[f]);
      if (Number.isNaN(v) || v < 0) {
        res.status(400);
        throw new Error(`Invalid value for ${f}`);
      }
      update[f] = v;
    }
  }
  if (req.body.pfEnabled !== undefined) update.pfEnabled = !!req.body.pfEnabled;
  if (req.body.effectiveFrom) update.effectiveFrom = new Date(req.body.effectiveFrom);
  update.updatedBy = req.user._id;

  if (update.monthlySalary === undefined) {
    const existing = await SalaryStructure.findOne({ employee: req.params.employeeId });
    if (!existing) {
      res.status(400);
      throw new Error('monthlySalary is required on first creation');
    }
  }

  const structure = await SalaryStructure.findOneAndUpdate(
    { employee: req.params.employeeId },
    { $set: update, $setOnInsert: { employee: req.params.employeeId, createdBy: req.user._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Keep Employee.monthlySalary in sync (single source of truth for quick reads).
  if (update.monthlySalary !== undefined) {
    employee.monthlySalary = update.monthlySalary;
    await employee.save();
  }

  res.json(structure);
});
