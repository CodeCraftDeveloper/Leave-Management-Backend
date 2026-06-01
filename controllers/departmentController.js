import asyncHandler from 'express-async-handler';
import Department from '../models/Department.js';
import Employee from '../models/Employee.js';
import {
  syncEmployeeRoles,
  renameDepartmentMembers,
} from '../services/departmentSyncService.js';
import { isSuperAdmin, departmentsForHead, resolveHeadScope } from '../utils/headScope.js';
import { normalizeDepartmentName, SUPERADMIN_EMAILS } from '../utils/constants.js';

const normalizeName = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeDepartmentInput = (value) => normalizeDepartmentName(normalizeName(value));
const normalizeCode = (value) => (typeof value === 'string' ? value.trim().toUpperCase() : '');

// Where employees land when removed from a department. Mirrors the Employee
// schema default so legacy filters keep working.
const UNASSIGNED_DEPARTMENT = 'General';

// Scoped heads may only act on the department(s) they oversee; the super admin
// is unrestricted. Throws 403 when a scoped head reaches outside their scope.
const assertCanManageDepartment = async (res, user, departmentName) => {
  if (isSuperAdmin(user)) return;
  const names = await departmentsForHead(user);
  if (!names.includes(departmentName)) {
    res.status(403);
    throw new Error('You can only manage departments you head');
  }
};

// Load every active employee assigned to a department so the management
// screen can render member counts without a second round-trip.
const decorateWithCounts = async (departments) => {
  const names = departments.map((d) => d.name);
  const employees = await Employee.find({
    active: true,
    department: { $in: names },
    role: { $ne: 'head' },
  })
    .sort({ department: 1, role: -1, name: 1 })
    .select('name employeeId email role department active')
    .lean();

  const membersByName = new Map();
  for (const employee of employees) {
    const key = employee.department || 'Unassigned';
    const members = membersByName.get(key) || [];
    members.push(employee);
    membersByName.set(key, members);
  }

  return departments.map((d) => ({
    ...d.toObject(),
    memberCount: membersByName.get(d.name)?.length || 0,
    members: membersByName.get(d.name) || [],
  }));
};

// @desc List departments with assigned heads + member counts.
// @route GET /api/manage/departments
export const listDepartments = asyncHandler(async (req, res) => {
  const { includeInactive } = req.query;
  const filter = includeInactive === 'true' ? {} : { active: true };
  // A scoped head only sees departments that contain employees routed to their
  // approval email; the super admin sees them all.
  let allDepartmentNames;
  if (!isSuperAdmin(req.user)) {
    allDepartmentNames = await departmentsForHead(req.user);
    filter.name = { $in: allDepartmentNames };
  } else {
    allDepartmentNames = await Department.find({ active: true }).distinct('name');
  }
  const departments = await Department.find(filter)
    .sort({ name: 1 })
    .populate('heads', 'name employeeId email role department active');
  res.json({ items: await decorateWithCounts(departments), masterDepartments: allDepartmentNames });
});

// @desc Create a department (heads optional at creation).
// @route POST /api/manage/departments
export const createDepartment = asyncHandler(async (req, res) => {
  const name = normalizeDepartmentInput(req.body.name);
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
    const valid = await Employee.countDocuments({
      _id: { $in: headIds },
      active: true,
      role: { $in: ['employee', 'dept_head', 'head'] },
    });
    if (valid !== headIds.length) {
      res.status(400);
      throw new Error('One or more selected heads are invalid');
    }
  }

  // A scoped head who creates a department is mapped onto it so they keep
  // visibility/management rights over what they just made. The super admin sees
  // everything regardless, so no need to pin them.
  if (!isSuperAdmin(req.user) && !headIds.map(String).includes(String(req.user._id))) {
    headIds.push(req.user._id);
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
  await assertCanManageDepartment(res, req.user, department.name);

  const previousName = department.name;
  const nextName = req.body.name === undefined ? department.name : normalizeDepartmentInput(req.body.name);
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
    const valid = await Employee.countDocuments({
      _id: { $in: req.body.heads },
      active: true,
      role: { $in: ['employee', 'dept_head', 'head'] },
    });
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
  await assertCanManageDepartment(res, req.user, department.name);

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

const memberSelect = 'name employeeId email phone designation role department active';

// @desc Department detail — the roster plus everyone you could add to it.
// @route GET /api/manage/departments/:id
export const getDepartment = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id).populate(
    'heads',
    'name employeeId email role department active'
  );
  if (!department) {
    res.status(404);
    throw new Error('Department not found');
  }
  await assertCanManageDepartment(res, req.user, department.name);
  const scope = await resolveHeadScope(req.user);

  // Members are the staff who *belong* to the department (employees +
  // the single department head). Overseeing `head` accounts are surfaced
  // separately via department.heads, not as members.
  const memberFilter = {
    department: department.name,
    active: true,
    role: { $in: ['employee', 'dept_head'] },
  };
  if (!scope.isSuper) memberFilter._id = { $in: scope.employeeIds };
  const members = await Employee.find(memberFilter)
    .sort({ role: -1, name: 1 })
    .select(memberSelect)
    .lean();

  // Candidates to ADD: active employees who aren't already in this department.
  // Heads aren't movable members, so they're excluded.
  const search = (req.query.search || '').trim();
  const availableFilter = {
    active: true,
    role: { $in: ['employee', 'dept_head'] },
    department: { $ne: department.name },
  };
  if (!scope.isSuper) availableFilter._id = { $in: [] };
  if (search) {
    availableFilter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { employeeId: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }
  const availableEmployees = await Employee.find(availableFilter)
    .sort({ name: 1 })
    .limit(100)
    .select(memberSelect)
    .lean();

  const departmentHead = members.find((m) => m.role === 'dept_head') || null;
  const headGroup = (department.heads || []).filter((h) => h.role === 'head');

  res.json({ department, members, availableEmployees, departmentHead, headGroup });
});

// @desc Add an existing employee to a department (membership edit only — no
//       records are created or destroyed).
// @route POST /api/manage/departments/:id/members
export const addMember = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department || !department.active) {
    res.status(404);
    throw new Error('Department not found');
  }
  await assertCanManageDepartment(res, req.user, department.name);

  const employee = await Employee.findOne({ _id: req.body.employeeId, active: true });
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }
  if (employee.role === 'head') {
    res.status(400);
    throw new Error('Head accounts oversee departments and cannot be added as members');
  }
  if (employee.department === department.name) {
    res.status(409);
    throw new Error(`${employee.name} is already in ${department.name}`);
  }

  // A department head moving to another department reverts to a plain member —
  // they can be re-promoted in their new home.
  if (employee.role === 'dept_head') {
    await Department.updateMany({ heads: employee._id }, { $pull: { heads: employee._id } });
    employee.role = 'employee';
  }
  employee.department = department.name;
  await employee.save();

  res.json({ message: `${employee.name} added to ${department.name}`, employee });
});

// @desc Remove an employee from a department. They are reassigned to the
//       Unassigned bucket — their account and leave history are untouched.
// @route DELETE /api/manage/departments/:id/members/:employeeId
export const removeMember = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department) {
    res.status(404);
    throw new Error('Department not found');
  }
  await assertCanManageDepartment(res, req.user, department.name);

  const employee = await Employee.findById(req.params.employeeId);
  if (!employee || employee.department !== department.name) {
    res.status(404);
    throw new Error('Employee is not a member of this department');
  }
  if (isSuperAdmin(employee)) {
    res.status(400);
    throw new Error('The super admin cannot be removed from a department');
  }

  // Demote a department head being pulled out so the department isn't left
  // pointing at an outside approver.
  if (employee.role === 'dept_head') {
    await Department.updateOne({ _id: department._id }, { $pull: { heads: employee._id } });
    employee.role = 'employee';
  }
  employee.department = UNASSIGNED_DEPARTMENT;
  await employee.save();

  res.json({ message: `${employee.name} removed from ${department.name}`, employee });
});

// @desc Set (or clear) the single department head. Exactly one dept_head per
//       department: promoting one demotes any previous holder.
// @route PATCH /api/manage/departments/:id/department-head
export const setDepartmentHead = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department || !department.active) {
    res.status(404);
    throw new Error('Department not found');
  }
  await assertCanManageDepartment(res, req.user, department.name);

  const { employeeId } = req.body;
  if (employeeId) {
    const candidate = await Employee.findOne({
      _id: employeeId,
      active: true,
      role: { $in: ['employee', 'dept_head'] },
    });
    if (!candidate) {
      res.status(400);
      throw new Error('Choose an active employee from this organisation');
    }
  }

  // syncEmployeeRoles demotes every other dept_head in this department and
  // promotes the chosen one (pinning their department), in one shot.
  await syncEmployeeRoles(department.name, employeeId ? [employeeId] : []);

  // Rebuild heads[] = overseeing heads (role head) + the single new dept head.
  const retainedHeads = await Employee.find({
    _id: { $in: department.heads },
    role: 'head',
  }).select('_id');
  department.heads = retainedHeads.map((h) => h._id);
  if (employeeId) department.heads.push(employeeId);
  await department.save();

  const populated = await Department.findById(department._id).populate(
    'heads',
    'name employeeId email role department active'
  );
  res.json({
    message: employeeId ? 'Department head assigned' : 'Department head cleared',
    department: populated,
  });
});

// @desc Set the overall Heads group for a department (role `head`, scoped to
//       this department). Adding grants the head role; removing revokes it
//       unless the person still heads another department.
// @route PATCH /api/manage/departments/:id/heads-group
export const setHeadsGroup = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department || !department.active) {
    res.status(404);
    throw new Error('Department not found');
  }
  await assertCanManageDepartment(res, req.user, department.name);

  const nextIds = [...new Set((Array.isArray(req.body.employeeIds) ? req.body.employeeIds : []).map(String))];
  if (nextIds.length) {
    const valid = await Employee.countDocuments({ _id: { $in: nextIds }, active: true });
    if (valid !== nextIds.length) {
      res.status(400);
      throw new Error('One or more selected heads are invalid');
    }
    // Grant the head role to everyone in the group.
    await Employee.updateMany(
      { _id: { $in: nextIds }, role: { $ne: 'head' } },
      { $set: { role: 'head' } }
    );
  }

  // Who is currently an overseeing head on this department.
  const currentHeads = await Employee.find({ _id: { $in: department.heads }, role: 'head' }).select('_id email notificationEmail');
  const removed = currentHeads.filter((h) => !nextIds.includes(String(h._id)));

  // Rebuild heads[] = single dept head (if any) + the new head group.
  const deptHead = await Employee.find({ _id: { $in: department.heads }, role: 'dept_head' }).select('_id');
  department.heads = [...deptHead.map((d) => d._id), ...nextIds];
  await department.save();

  // Revoke the head role from anyone removed who no longer heads anything else.
  for (const head of removed) {
    const headEmails = [head.email, head.notificationEmail].map((value) => String(value || '').toLowerCase());
    if (headEmails.some((email) => SUPERADMIN_EMAILS.includes(email))) continue;
    const stillHeadsElsewhere = await Department.exists({ heads: head._id, _id: { $ne: department._id } });
    if (!stillHeadsElsewhere) {
      await Employee.updateOne({ _id: head._id, role: 'head' }, { $set: { role: 'employee' } });
    }
  }

  const populated = await Department.findById(department._id).populate(
    'heads',
    'name employeeId email role department active'
  );
  res.json({ message: 'Heads updated', department: populated });
});
