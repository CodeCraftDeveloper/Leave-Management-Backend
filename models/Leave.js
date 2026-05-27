import mongoose from 'mongoose';

const leaveSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    leaveType: {
      type: String,
      enum: ['casual', 'sick', 'emergency', 'paid', 'unpaid'],
      required: true,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    totalDays: { type: Number, required: true, min: 0.5 },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    attachment: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
      index: true,
    },
    adminComment: { type: String, default: '' },
    actionedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    actionedAt: { type: Date },
    staffingOverride: { type: Boolean, default: false },
    staffingOverrideReason: { type: String, default: '', trim: true, maxlength: 500 },
    staffingSnapshot: { type: mongoose.Schema.Types.Mixed, default: undefined },
    isHalfDay: { type: Boolean, default: false },
    halfDaySession: {
      type: String,
      enum: ['first_half', 'second_half', ''],
      default: '',
    },
  },
  { timestamps: true }
);

leaveSchema.index({ employee: 1, startDate: 1, endDate: 1 });

const Leave = mongoose.model('Leave', leaveSchema);
export default Leave;
