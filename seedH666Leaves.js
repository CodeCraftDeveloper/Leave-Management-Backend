import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '.env') });

import connectDB from './config/db.js';
import Employee from './models/Employee.js';
import Leave from './models/Leave.js';

const run = async () => {
  await connectDB();

  // 1. Find H666 (CHANDI CHARAN MAHATO) — the employee
  const h666 = await Employee.findOne({ employeeId: 'H666' });
  if (!h666) { console.error('Employee H666 not found'); process.exit(1); }
  console.log(`H666: ${h666.name} | ${h666.department} | role: ${h666.role}`);

  // 2. Find H641 (Shikhar Tripathi) — the dept_head for Digital Market
  const h641 = await Employee.findOne({ employeeId: 'H641' });
  if (!h641) { console.error('Department head H641 not found'); process.exit(1); }
  console.log(`H641 (dept_head): ${h641.name} | ${h641.department} | role: ${h641.role}`);

  // 3. Find all previous (past) leaves for H666
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const pastLeaves = await Leave.find({
    employee: h666._id,
    endDate: { $lt: now },
  }).populate('actionedBy', 'name employeeId');

  console.log(`\nFound ${pastLeaves.length} past leave(s) for H666`);

  if (pastLeaves.length === 0) {
    console.log('No past leaves to update.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // 4. Update each leave — set approver + actionedBy to the department head (H641)
  //    Following the controller pattern: manageController.actionLeave sets
  //    actionedBy to the reviewer (dept_head), and leaveController.applyLeave
  //    sets approver to the resolved approver (dept_head for employees).
  for (const leave of pastLeaves) {
    console.log(`\n[${leave.status}] ${leave.leaveType} ${leave.startDate.toISOString().slice(0,10)} -> ${leave.endDate.toISOString().slice(0,10)} (${leave.totalDays}d)`);
    console.log(`  Current: approver=${leave.approver} | actionedBy=${leave.actionedBy ? leave.actionedBy.employeeId + ' ' + leave.actionedBy.name : 'N/A'}`);

    leave.approver = h641._id;
    leave.actionedBy = h641._id;
    leave.adminComment = 'Approved by department head';
    leave.actionedAt = leave.actionedAt || new Date();

    await leave.save();
    console.log(`  Updated: approver=${h641.employeeId} ${h641.name} | actionedBy=${h641.employeeId} ${h641.name}`);
  }

  console.log(`\nDone. ${pastLeaves.length} leave(s) updated — department head (H641) set as approver/actioner.`);
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
