import mongoose from 'mongoose';

const pointSchema = new mongoose.Schema(
  {
    time: { type: Date, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
  },
  { _id: false }
);

const attendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },
    date: { type: Date, required: true },
    checkIn: { type: pointSchema, default: undefined },
    checkOut: { type: pointSchema, default: undefined },
    // Total time between check-in and check-out (hours, 2dp).
    totalHours: { type: Number, default: null },
    // Excludes breaks if you ever track them; same as totalHours today.
    workHours: { type: Number, default: 0 },
    // Hours beyond the configured requiredHours threshold (default 8).
    overtimeHours: { type: Number, default: 0 },
    // Minutes after the configured `lateAfterTime` (default 09:45).
    lateMinutes: { type: Number, default: 0 },
    status: {
      type: String,
      enum: [
        // Final/derived states (set after check-out or by cron/admin):
        'PRESENT', 'ABSENT', 'HALF_DAY', 'LATE', 'ON_LEAVE', 'HOLIDAY', 'WEEK_OFF',
        // Transient states while the workday is in progress:
        'checked-in', 'checked-out', 'absent',
      ],
      default: 'checked-in',
    },
    remarks: { type: String, default: '', trim: true, maxlength: 500 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  },
  { timestamps: true }
);

// One attendance record per employee per calendar day.
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

const Attendance = mongoose.model('Attendance', attendanceSchema);
export default Attendance;
