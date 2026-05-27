import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Legacy field kept for API compatibility. There is no yearly/type-wise quota;
// the only free-leave policy is the monthly allowance used by payroll.
const defaultBalance = () => ({});

const employeeSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      default: undefined,
    },
    password: { type: String, required: true, minlength: 6, select: false },
    phone: { type: String, trim: true },
    address: { type: String, trim: true, default: '' },
    department: { type: String, default: 'General' },
    designation: { type: String, default: 'Employee' },
    // 'employee' | 'admin' | 'hr' — HR added for the management panel layer.
    role: { type: String, enum: ['employee', 'admin', 'hr'], default: 'employee' },
    // Monthly CTC reference figure used by payroll. Detailed components
    // live in SalaryStructure; this is the single source of truth for
    // per-day salary calculation: perDay = monthlySalary / daysInMonth.
    monthlySalary: { type: Number, default: 0, min: 0 },
    leaveBalance: { type: Object, default: defaultBalance },
    profileImage: { type: String, default: '' },
    joiningDate: { type: Date, default: Date.now },
    // ACTIVE/INACTIVE mirrors the existing boolean `active` flag — kept
    // both so legacy queries (active: true) keep working.
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

employeeSchema.pre('save', async function (next) {
  // Keep status and the legacy `active` flag in sync.
  if (this.isModified('status')) this.active = this.status === 'ACTIVE';
  else if (this.isModified('active')) this.status = this.active ? 'ACTIVE' : 'INACTIVE';

  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

employeeSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

const Employee = mongoose.model('Employee', employeeSchema);
export default Employee;
