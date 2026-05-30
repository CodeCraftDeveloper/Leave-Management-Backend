import mongoose from 'mongoose';

// Detailed monthly salary breakdown (CTC style). Optional — payroll falls
// back to Employee.monthlySalary if no structure exists. The sum of
// components is NOT enforced to equal monthlySalary so admins can model
// real-world CTC quirks; payroll uses monthlySalary as the gross base.
//
// `monthlySalary` IS the Gross Salary used by payroll. The remaining fields
// are descriptive payslip line-items grouped into:
//   • Earnings (part of gross): basicSalary, other
//   • Employer cost (on top of gross): bonus, gratuity, employerPf, employerEsic
//   • CTC: total cost to company
//   • Deductions (reduce take-home): employeePf, employeeEsic, deduction
const salaryStructureSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      unique: true,
      index: true,
    },
    monthlySalary: { type: Number, required: true, min: 0 }, // Gross Salary (payroll base)
    basicSalary: { type: Number, default: 0, min: 0 },
    other: { type: Number, default: 0, min: 0 },
    bonus: { type: Number, default: 0, min: 0 },
    gratuity: { type: Number, default: 0, min: 0 },
    employerPf: { type: Number, default: 0, min: 0 },
    employerEsic: { type: Number, default: 0, min: 0 },
    ctc: { type: Number, default: 0, min: 0 },
    deduction: { type: Number, default: 0, min: 0 },
    employeePf: { type: Number, default: 0, min: 0 },
    employeeEsic: { type: Number, default: 0, min: 0 },
    effectiveFrom: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  },
  { timestamps: true }
);

const SalaryStructure = mongoose.model('SalaryStructure', salaryStructureSchema);
export default SalaryStructure;
