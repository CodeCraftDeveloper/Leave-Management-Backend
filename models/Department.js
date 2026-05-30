import mongoose from 'mongoose';

// Departments are first-class so leaves of org structure don't rot when a
// dept_head moves on or a department gets renamed. The employee.department
// field stays as the display name (kept in sync on rename) so legacy filters,
// the seed file, payroll/calendar queries, and the staffing-coverage logic
// keep working without a wider migration.
const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true, uppercase: true, default: '' },
    description: { type: String, trim: true, default: '' },
    // Multiple heads supported so the spreadsheet's `a@x/b@x` convention works
    // — any one of them can approve, all are notified on apply.
    heads: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

departmentSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

const Department = mongoose.model('Department', departmentSchema);
export default Department;
