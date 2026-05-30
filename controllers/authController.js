import asyncHandler from 'express-async-handler';
import crypto from 'crypto';
import Employee from '../models/Employee.js';
import generateToken from '../utils/generateToken.js';
import { sendVerificationCodeEmail } from '../services/emailService.js';
import { isSuperAdmin } from '../utils/headScope.js';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const OTP_TTL_MINUTES = 15;
const OTP_MAX_ATTEMPTS = 5;

const generateOtp = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

const sanitize = (u) => ({
  _id: u._id,
  employeeId: u.employeeId,
  name: u.name,
  email: u.email || '',
  phone: u.phone,
  department: u.department,
  designation: u.designation,
  role: u.role,
  // Only the reserved super-admin head has org-wide visibility; every other
  // head is scoped to their mapped department(s). The client/mobile apps use
  // this to gate super-admin-only controls.
  isSuperAdmin: isSuperAdmin(u),
  leaveBalance: u.leaveBalance,
  profileImage: u.profileImage,
  joiningDate: u.joiningDate,
  emailVerified: !!u.emailVerified,
  needsEmailSetup: !u.email,
  needsEmailVerification: !!u.email && !u.emailVerified,
});

// @desc Unified login
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

// @desc Register employee
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

// Issue and email a fresh OTP for the user's current email. Stores the code
// on the user doc with a TTL so verification can be checked statelessly.
const issueOtp = async (user) => {
  const code = generateOtp();
  user.emailVerifyCode = code;
  user.emailVerifyExpires = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  user.emailVerifyAttempts = 0;
  await user.save();
  await sendVerificationCodeEmail({
    employee: user,
    code,
    expiresInMinutes: OTP_TTL_MINUTES,
  });
};

// @desc Set/update email and send a verification OTP. Sets emailVerified=false
// until the user submits the OTP back via POST /auth/email/verify.
// @route PUT /api/auth/email
export const setEmail = asyncHandler(async (req, res) => {
  const raw = (req.body?.email || '').trim().toLowerCase();
  if (!raw || !EMAIL_PATTERN.test(raw)) {
    res.status(400);
    throw new Error('A valid email is required');
  }
  const taken = await Employee.findOne({ email: raw, _id: { $ne: req.user._id } });
  if (taken) {
    res.status(409);
    throw new Error('This email is already in use');
  }

  // Load the user with hidden OTP fields so we can stamp them in one save.
  const user = await Employee.findById(req.user._id).select(
    '+emailVerifyCode +emailVerifyExpires +emailVerifyAttempts'
  );
  user.email = raw;
  user.emailVerified = false;
  await issueOtp(user);

  res.json({
    user: sanitize(user),
    message: `Verification code sent to ${raw}. Enter it within ${OTP_TTL_MINUTES} minutes.`,
  });
});

// @desc Resend the OTP for the email currently on file.
// @route POST /api/auth/email/resend
export const resendVerification = asyncHandler(async (req, res) => {
  if (!req.user.email) {
    res.status(400);
    throw new Error('No email on file. Set an email first.');
  }
  if (req.user.emailVerified) {
    res.json({ message: 'Email already verified' });
    return;
  }
  const user = await Employee.findById(req.user._id).select(
    '+emailVerifyCode +emailVerifyExpires +emailVerifyAttempts'
  );
  await issueOtp(user);
  res.json({
    message: `Verification code re-sent to ${user.email}. Expires in ${OTP_TTL_MINUTES} minutes.`,
  });
});

// @desc Verify the email using the 6-digit OTP.
// @route POST /api/auth/email/verify
export const verifyEmail = asyncHandler(async (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!/^\d{6}$/.test(code)) {
    res.status(400);
    throw new Error('Enter the 6-digit code from your email');
  }
  const user = await Employee.findById(req.user._id).select(
    '+emailVerifyCode +emailVerifyExpires +emailVerifyAttempts'
  );
  if (!user.email) {
    res.status(400);
    throw new Error('No email on file');
  }
  if (user.emailVerified) {
    res.json({ user: sanitize(user), message: 'Email already verified' });
    return;
  }
  if (!user.emailVerifyCode || !user.emailVerifyExpires) {
    res.status(400);
    throw new Error('No verification request found. Request a new code.');
  }
  if (user.emailVerifyExpires < new Date()) {
    res.status(400);
    throw new Error('Code expired. Request a new one.');
  }
  if (user.emailVerifyAttempts >= OTP_MAX_ATTEMPTS) {
    res.status(429);
    throw new Error('Too many incorrect attempts. Request a new code.');
  }
  if (user.emailVerifyCode !== code) {
    user.emailVerifyAttempts += 1;
    await user.save();
    res.status(400);
    throw new Error('Incorrect code');
  }

  user.emailVerified = true;
  user.emailVerifyCode = undefined;
  user.emailVerifyExpires = undefined;
  user.emailVerifyAttempts = 0;
  await user.save();
  res.json({ user: sanitize(user), message: 'Email verified' });
});
