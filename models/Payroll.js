import mongoose from 'mongoose';

// One payroll row per (employee, month, year). The combination is enforced
// unique so payroll cannot be double-generated.
//
// Rules used:
//   perDaySalary    = monthlySalary / totalDaysInMonth (actual)
//   freeLeaves      = company quota per month (default 2)
//   extraLeaveDays  = max(0, leavesTaken - freeLeaves)
//   leaveDeduction  = extraLeaveDays * perDaySalary
//   otSalary        = sundaysWorked * perDaySalary * sundayPayMultiplier (2x)
//   netSalary       = monthlySalary - leaveDeduction
//   totalPayable    = netSalary + otSalary
const payrollSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },
    month: { type: Number, required: true, min: 1, max: 12 }, // 1-based
    year: { type: Number, required: true },

    // ── Attendance summary for the month ─────────────────────────
    totalDaysInMonth: { type: Number, required: true },
    presentDays: { type: Number, default: 0 },
    absentDays: { type: Number, default: 0 },
    leavesTaken: { type: Number, default: 0 },     // approved leave days that fell in the month
    freeLeaves: { type: Number, default: 0 },      // configured quota
    extraLeaveDays: { type: Number, default: 0 },  // leavesTaken beyond freeLeaves
    sundaysWorked: { type: Number, default: 0 },   // qualifying Sundays (>= sundayMinHours)
    weekOffDays: { type: Number, default: 0 },
    holidayDays: { type: Number, default: 0 },

    // ── Salary components ────────────────────────────────────────
    monthlySalary: { type: Number, required: true, min: 0 },
    perDaySalary: { type: Number, required: true, min: 0 },
    leaveDeduction: { type: Number, default: 0, min: 0 },
    sundayBonus: { type: Number, default: 0, min: 0 }, // legacy alias for otSalary
    otSalary: { type: Number, default: 0, min: 0 },
    totalPayable: { type: Number, default: 0, min: 0 },
    otCreditDate: { type: Date },
    netSalary: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: ['DRAFT', 'GENERATED', 'PAID', 'CANCELLED'],
      default: 'GENERATED',
    },
    paidAt: { type: Date },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    remarks: { type: String, default: '' },
  },
  { timestamps: true }
);

payrollSchema.index({ employee: 1, month: 1, year: 1 }, { unique: true });

const Payroll = mongoose.model('Payroll', payrollSchema);
export default Payroll;
