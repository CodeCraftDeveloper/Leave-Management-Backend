import asyncHandler from 'express-async-handler';
import Department from '../models/Department.js';
import Employee from '../models/Employee.js';
import {
  syncEmployeeRoles,
  renameDepartmentMembers,
} from '../services/departmentSyncService.js';
import { isSuperAdmin } from '../utils/headScope.js';

const normalizeName = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeCode = (value) => (typeof value === 'string' ? value.trim().toUpperCase() : '');

// Load every active employee assigned to a department so the management
// screen can render member counts without a second round-trip.
const decorateWithCounts = async (departments) => {
  const names = departments.map((d) => d.name);
  const counts = await Employee.aggregate([
    { $match: { active: true, department: { $in: names } } },
    { $group: { _id: '$department', total: { $sum: 1 } } },
  ]);
  const totalByName = new Map(counts.map((row) => [row._id, row.total]));
  return departments.map((d) => ({
    ...d.toObject(),
    memberCount: totalByName.get(d.name) || 0,
  }));
};

// @desc List departments with assigned heads + member counts.
// @route GET /api/manage/departments
export const listDepartments = asyncHandler(async (req, res) => {
  const { includeInactive } = req.query;
  const filter = includeInactive === 'true' ? {} : { active: true };
  // A scoped head only sees the department(s) they are mapped to; the super
  // admin sees them all.
  if (!isSuperAdmin(req.user)) {
    filter.heads = req.user._id;
  }
  const departments = await Department.find(filter)
    .sort({ name: 1 })
    .populate('heads', 'name employeeId email role department active');
  res.json({ items: await decorateWithCounts(departments) });
});

// @desc Create a department (heads optional at creation).
// @route POST /api/manage/departments
export const createDepartment = asyncHandler(async (req, res) => {
  const name = normalizeName(req.body.name);
  const code = normalizeCode(req.body.code);
  const description = normalizeName(req.body.description);
  if (!name) {
    res.status(400);
    throw new Error('Department name is required');
  }

  // Case-insensitive uniqueness — "HR" and "hr" should clash.
  const clash = await Department.findOne({ name: { $regex: `^${name}$`, $options: 'i' } });
  if (clash) {
    res.status(409);
    throw new Error('A department with this name already exists');
  }

  const headIds = Array.isArray(req.body.heads) ? req.body.heads : [];
  if (headIds.length) {
    const valid = await Employee.countDocuments({ _id: { $in: headIds }, active: true });
    if (valid !== headIds.length) {
      res.status(400);
      throw new Error('One or more selected heads are invalid');
    }
  }

  const department = await Department.create({ name, code, description, heads: headIds });
  if (headIds.length) await syncEmployeeRoles(name, headIds);

  const populated = await Department.findById(department._id).populate(
    'heads',
    'name employeeId email role department active'
  );
  res.status(201).json(populated);
});

// @desc Update a department (rename, set heads, toggle active).
// @route PATCH /api/manage/departments/:id
export const updateDepartment = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department) {
    res.status(404);
    throw new Error('Department not found');
  }

  const previousName = department.name;
  const nextName = req.body.name === undefined ? department.name : normalizeName(req.body.name);
  if (!nextName) {
    res.status(400);
    throw new Error('Department name cannot be empty');
  }

  if (nextName !== previousName) {
    const clash = await Department.findOne({
      _id: { $ne: department._id },
      name: { $regex: `^${nextName}$`, $options: 'i' },
    });
    if (clash) {
      res.status(409);
      throw new Error('A department with this name already exists');
    }
  }

  if (req.body.code !== undefined) department.code = normalizeCode(req.body.code);
  if (req.body.description !== undefined) {
    department.description = normalizeName(req.body.description);
  }
  if (typeof req.body.active === 'boolean') department.active = req.body.active;

  let headsChanged = false;
  if (Array.isArray(req.body.heads)) {
    const valid = await Employee.countDocuments({ _id: { $in: req.body.heads }, active: true });
    if (valid !== req.body.heads.length) {
      res.status(400);
      throw new Error('One or more selected heads are invalid');
    }
    department.heads = req.body.heads;
    headsChanged = true;
  }

  department.name = nextName;
  await department.save();

  if (nextName !== previousName) await renameDepartmentMembers(previousName, nextName);
  if (headsChanged) await syncEmployeeRoles(nextName, department.heads);

  const populated = await Department.findById(department._id).populate(
    'heads',
    'name employeeId email role department active'
  );
  res.json(populated);
});

// @desc Archive a department. Refuses if any active employee is still
//       assigned — protects against orphaning approver lookups.
// @route DELETE /api/manage/departments/:id
export const deleteDepartment = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department) {
    res.status(404);
    throw new Error('Department not found');
  }

  const members = await Employee.countDocuments({
    active: true,
    department: department.name,
  });
  if (members > 0) {
    res.status(409);
    throw new Error(
      `${members} active employee(s) still belong to ${department.name}. Reassign them first.`
    );
  }

  // Demote any lingering dept_heads that referenced this department.
  await syncEmployeeRoles(department.name, []);
  department.active = false;
  department.heads = [];
  await department.save();
  res.json({ message: 'Department archived', department });
});
