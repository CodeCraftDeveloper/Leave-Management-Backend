import Department from '../models/Department.js';
import Employee from '../models/Employee.js';

// One-shot backfill: makes sure every distinct Employee.department string has
// a Department doc, and that every existing dept_head is listed under their
// department. Idempotent — safe to call on every boot.
export const backfillDepartments = async () => {
  const departmentNames = (await Employee.distinct('department', { active: true }))
    .map((name) => (typeof name === 'string' ? name.trim() : ''))
    .filter(Boolean);

  if (!departmentNames.length) return { created: 0, updatedHeads: 0 };

  let created = 0;
  let updatedHeads = 0;

  for (const name of departmentNames) {
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
  const headIdStrings = headIds.map(String);

  // Demote anyone who was a dept_head of this department but is no longer in the list.
  await Employee.updateMany(
    {
      role: 'dept_head',
      department: departmentName,
      _id: { $nin: headIdStrings },
    },
    { $set: { role: 'employee' } }
  );

  // Promote everyone in the list to dept_head and pin their department.
  if (headIdStrings.length) {
    await Employee.updateMany(
      { _id: { $in: headIdStrings } },
      { $set: { role: 'dept_head', department: departmentName } }
    );
  }
};

// Propagate a department rename to every employee assigned to the old name.
export const renameDepartmentMembers = async (oldName, newName) => {
  if (!oldName || !newName || oldName === newName) return { matched: 0, modified: 0 };
  const result = await Employee.updateMany(
    { department: oldName },
    { $set: { department: newName } }
  );
  return { matched: result.matchedCount ?? 0, modified: result.modifiedCount ?? 0 };
};
