import asyncHandler from 'express-async-handler';
import Employee from '../models/Employee.js';

// @desc Update own profile
// @route PATCH /api/employees/profile
export const updateProfile = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.user._id);
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }
  const { name, phone, department, designation, profileImage } = req.body;
  if (name !== undefined || phone !== undefined || department !== undefined || designation !== undefined) {
    res.status(403);
    throw new Error('Personal information can only be changed by an admin');
  }
  if (profileImage !== undefined) employee.profileImage = profileImage;
  await employee.save();
  res.json(employee);
});

// @desc Change password
// @route PATCH /api/employees/password
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    res.status(400);
    throw new Error('Invalid password input');
  }
  const employee = await Employee.findById(req.user._id).select('+password');
  if (!(await employee.matchPassword(currentPassword))) {
    res.status(401);
    throw new Error('Current password is incorrect');
  }
  employee.password = newPassword;
  await employee.save();
  res.json({ message: 'Password updated successfully' });
});
