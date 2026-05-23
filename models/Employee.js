import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const defaultBalance = () => ({
  casual: 12,
  sick: 10,
  emergency: 5,
  paid: 15,
  unpaid: 30,
});

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
    department: { type: String, default: 'General' },
    designation: { type: String, default: 'Employee' },
    role: { type: String, enum: ['employee', 'admin'], default: 'employee' },
    leaveBalance: { type: Object, default: defaultBalance },
    profileImage: { type: String, default: '' },
    joiningDate: { type: Date, default: Date.now },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

employeeSchema.pre('save', async function (next) {
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
