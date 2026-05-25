import asyncHandler from 'express-async-handler';
import Employee from '../models/Employee.js';
import generateToken from '../utils/generateToken.js';

const sanitize = (u) => ({
  _id: u._id,
  employeeId: u.employeeId,
  name: u.name,
  email: u.email || '',
  phone: u.phone,
  department: u.department,
  designation: u.designation,
  role: u.role,
  leaveBalance: u.leaveBalance,
  profileImage: u.profileImage,
  joiningDate: u.joiningDate,
  needsEmailSetup: !u.email,
});

// @desc Unified login (Admin and Employee)
// @route POST /api/auth/login
export const login = asyncHandler(async (req, res) => {
  const { username, employeeId, email, password } = req.body;
  const identifier = username || employeeId || email;
  if (!identifier || !password) {
    res.status(400);
    throw new Error('Identifier and password are required');
  }
  let query = {};
  if (identifier.includes('@')) {
    query = { email: identifier.toLowerCase() };
  } else {
    query = { employeeId: identifier.toUpperCase() };
  }
  const user = await Employee.findOne(query).select('+password');
  if (!user || !user.active || !(await user.matchPassword(password))) {
    res.status(401);
    throw new Error('Invalid credentials');
  }
  res.json({ user: sanitize(user), token: generateToken(user._id, user.role) });
});

// @desc Register employee (admin only - but exposed for setup)
// @route POST /api/auth/register
export const registerEmployee = asyncHandler(async (req, res) => {
  const { employeeId, name, email, password, department, designation, phone, role } = req.body;
  if (!employeeId || !name || !email || !password) {
    res.status(400);
    throw new Error('Missing required fields');
  }
  const exists = await Employee.findOne({
    $or: [{ email: email.toLowerCase() }, { employeeId: employeeId.toUpperCase() }],
  });
  if (exists) {
    res.status(400);
    throw new Error('Employee already exists');
  }
  const user = await Employee.create({
    employeeId,
    name,
    email,
    password,
    department,
    designation,
    phone,
    role: role || 'employee',
  });
  res.status(201).json({ user: sanitize(user), token: generateToken(user._id, user.role) });
});

// @desc Get current user
// @route GET /api/auth/me
export const me = asyncHandler(async (req, res) => {
  res.json({ user: sanitize(req.user) });
});

// @desc Set/update email for the current user (used when account was seeded without one)
// @route PUT /api/auth/email
export const setEmail = asyncHandler(async (req, res) => {
  const raw = (req.body?.email || '').trim().toLowerCase();
  if (!raw || !/^\S+@\S+\.\S+$/.test(raw)) {
    res.status(400);
    throw new Error('A valid email is required');
  }
  const taken = await Employee.findOne({ email: raw, _id: { $ne: req.user._id } });
  if (taken) {
    res.status(409);
    throw new Error('This email is already in use');
  }
  req.user.email = raw;
  await req.user.save();
  res.json({ user: sanitize(req.user) });
});
