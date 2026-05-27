import mongoose from 'mongoose';

// Per-employee, per-leave-type, per-year balance ledger.
// remainingBalance = openingBalance - usedLeaves.
// usedLeaves grows when a leave is APPROVED, shrinks if APPROVED leave is cancelled.
const leaveBalanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },
    leaveType: {
      type: String,
      enum: ['casual', 'sick', 'emergency', 'paid', 'unpaid'],
      required: true,
    },
    year: { type: Number, required: true },
    openingBalance: { type: Number, default: 0, min: 0 },
    usedLeaves: { type: Number, default: 0, min: 0 },
    // Denormalized for fast reads; recalculated on every save.
    remainingBalance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

leaveBalanceSchema.index({ employee: 1, leaveType: 1, year: 1 }, { unique: true });

leaveBalanceSchema.pre('save', function (next) {
  this.remainingBalance = Math.max(0, this.openingBalance - this.usedLeaves);
  next();
});

const LeaveBalance = mongoose.model('LeaveBalance', leaveBalanceSchema);
export default LeaveBalance;
