import Department from '../models/Department.js';
import Employee from '../models/Employee.js';
import { normalizeDepartmentName } from '../utils/constants.js';

// One-shot backfill: makes sure every distinct Employee.department string has
// a Department doc, and that every existing dept_head is listed under their
// department. Idempotent — safe to call on every boot.
export const backfillDepartments = async () => {
  const rawDepartmentNames = (await Employee.distinct('department', { active: true }))
    .map((name) => (typeof name === 'string' ? name.trim() : ''))
    .filter(Boolean);
  const departmentNames = [...new Set(rawDepartmentNames.map(normalizeDepartmentName).filter(Boolean))];

  if (!departmentNames.length) return { created: 0, updatedHeads: 0 };

  let created = 0;
  let updatedHeads = 0;

  for (const name of departmentNames) {
    const aliases = rawDepartmentNames.filter((rawName) => normalizeDepartmentName(rawName) === name);
    if (aliases.some((rawName) => rawName !== name)) {
      await Employee.updateMany(
        { department: { $in: aliases.filter((rawName) => rawName !== name) } },
        { $set: { department: name } }
      );
    }

    let dept = await Department.findOne({ name });
    if (!dept) {
      dept = await Department.create({ name });
      created += 1;
    }

    const heads = await Employee.find({
      role: 'dept_head',
      active: true,
      department: name,
    }).select('_id');

    const existing = new Set((dept.heads || []).map(String));
    const next = new Set([...existing, ...heads.map((h) => String(h._id))]);
    if (next.size !== existing.size) {
      dept.heads = [...next];
      await dept.save();
      updatedHeads += 1;
    }
  }

  return { created, updatedHeads };
};

// Keep the legacy Employee.role flag and Employee.department string in sync
// with a department's heads list. Used by the department controller whenever
// the heads list is mutated.
export const syncEmployeeRoles = async (departmentName, headIds = []) => {
  const normalizedDepartmentName = normalizeDepartmentName(departmentName);
  const headIdStrings = headIds.map(String);
  const selectedAssignableHeads = headIdStrings.length
    ? await Employee.find({
        _id: { $in: headIdStrings },
        active: true,
        role: { $in: ['employee', 'dept_head'] },
      }).select('_id')
    : [];
  const assignableHeadIdStrings = selectedAssignableHeads.map((employee) => String(employee._id));

  // Demote only employee-level department heads. Top-level `head` accounts can
  // be mapped to many departments and must keep their global/scoped head role.
  await Employee.updateMany(
    {
      role: 'dept_head',
      department: normalizedDepartmentName,
      _id: { $nin: assignableHeadIdStrings },
    },
    { $set: { role: 'employee' } }
  );

  // Promote only regular employees selected as department reviewers. Do not
  // pin top-level `head` accounts to this department.
  if (assignableHeadIdStrings.length) {
    await Employee.updateMany(
      { _id: { $in: assignableHeadIdStrings } },
      { $set: { role: 'dept_head', department: normalizedDepartmentName } }
    );
  }
};

// Propagate a department rename to every employee assigned to the old name.
export const renameDepartmentMembers = async (oldName, newName) => {
  const normalizedNewName = normalizeDepartmentName(newName);
  if (!oldName || !normalizedNewName || oldName === normalizedNewName) return { matched: 0, modified: 0 };
  const result = await Employee.updateMany(
    { department: oldName },
    { $set: { department: normalizedNewName } }
  );
  return { matched: result.matchedCount ?? 0, modified: result.modifiedCount ?? 0 };
};
