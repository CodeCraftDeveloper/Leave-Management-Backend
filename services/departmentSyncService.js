import Department from '../models/Department.js';
import Employee from '../models/Employee.js';
import { normalizeDepartmentName } from '../utils/constants.js';

// One-shot backfill: makes sure every distinct Employee.department string has
// a Department doc and demotes legacy department-head records.
export const backfillDepartments = async () => {
  const rawDepartmentNames = (await Employee.distinct('department', { active: true }))
    .map((name) => (typeof name === 'string' ? name.trim() : ''))
    .filter(Boolean);
  const departmentNames = [...new Set(rawDepartmentNames.map(normalizeDepartmentName).filter(Boolean))];

  if (!departmentNames.length) return { created: 0, updatedHeads: 0, demotedLegacyDepartmentHeads: 0 };

  let created = 0;
  let updatedHeads = 0;
  const demoteResult = await Employee.updateMany(
    { role: 'dept_head' },
    { $set: { role: 'employee' } }
  );
  const demotedLegacyDepartmentHeads = demoteResult.modifiedCount ?? 0;

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
      _id: { $in: dept.heads || [] },
      role: 'head',
      active: true,
    }).select('_id');

    if (heads.length !== (dept.heads || []).length) {
      dept.heads = heads.map((head) => head._id);
      await dept.save();
      updatedHeads += 1;
    }
  }

  return { created, updatedHeads, demotedLegacyDepartmentHeads };
};

// Keep the legacy Employee.role flag and Employee.department string in sync
// with a department's heads list. Used by the department controller whenever
// the heads list is mutated.
export const syncEmployeeRoles = async (departmentName, headIds = []) => {
  return { departmentName: normalizeDepartmentName(departmentName), headIds, retired: true };
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
