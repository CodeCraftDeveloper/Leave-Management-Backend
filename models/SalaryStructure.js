import mongoose from 'mongoose';

// Detailed monthly salary breakdown. Optional — payroll falls back to
// Employee.monthlySalary if no structure exists. The sum of components
// is NOT enforced to equal monthlySalary so admins can model real-world
// CTC quirks; payroll uses monthlySalary as gross base.
const salaryStructureSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      unique: true,
      index: true,
    },
    monthlySalary: { type: Number, required: true, min: 0 },
    basicSalary: { type: Number, default: 0, min: 0 },
    hra: { type: Number, default: 0, min: 0 },
    conveyanceAllowance: { type: Number, default: 0, min: 0 },
    medicalAllowance: { type: Number, default: 0, min: 0 },
    specialAllowance: { type: Number, default: 0, min: 0 },
    pfEnabled: { type: Boolean, default: false },
    pfAmount: { type: Number, default: 0, min: 0 },
    professionalTax: { type: Number, default: 0, min: 0 },
    tds: { type: Number, default: 0, min: 0 },
    otherDeductions: { type: Number, default: 0, min: 0 },
    effectiveFrom: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  },
  { timestamps: true }
);

const SalaryStructure = mongoose.model('SalaryStructure', salaryStructureSchema);
export default SalaryStructure;
