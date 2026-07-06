// Find an employee by Employee ID and hard-delete them together with every
// record tied to them, using the same helper the API uses.
//
// Dry run (default) — reports what WOULD be deleted, changes nothing:
//   node scripts/purgeEmployee.js H684
//
// Execute the permanent delete:
//   node scripts/purgeEmployee.js H684 --confirm
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// .env lives one level up, in the server root.
dotenv.config({ path: resolve(__dirname, '..', '.env') });

const connectDB = (await import('../config/db.js')).default;
const Employee = (await import('../models/Employee.js')).default;
const { cascadeDeleteEmployee, countEmployeeRecords } = await import(
  '../utils/cascadeDeleteEmployee.js'
);

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const employeeIdArg = (args.find((a) => !a.startsWith('--')) || 'H684').trim().toUpperCase();

const run = async () => {
  await connectDB();

  const employee = await Employee.findOne({ employeeId: employeeIdArg });
  if (!employee) {
    console.log(`\nNo employee found with Employee ID "${employeeIdArg}". Nothing to delete.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log('\n=== Target employee ===');
  console.log(`  _id:         ${employee._id}`);
  console.log(`  employeeId:  ${employee.employeeId}`);
  console.log(`  name:        ${employee.name}`);
  console.log(`  email:       ${employee.email || '(none)'}`);
  console.log(`  department:  ${employee.department}`);
  console.log(`  role:        ${employee.role}`);
  console.log(`  active:      ${employee.active}`);

  const before = await countEmployeeRecords(employee);
  console.log('\n=== Associated records ===');
  for (const [key, value] of Object.entries(before)) {
    console.log(`  ${key}: ${value}`);
  }

  if (!confirm) {
    console.log('\nDRY RUN — nothing was deleted. Re-run with --confirm to permanently delete.');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log('\nDeleting...');
  const deleted = await cascadeDeleteEmployee(employee);
  console.log('=== Deleted ===');
  for (const [key, value] of Object.entries(deleted)) {
    console.log(`  ${key}: ${value}`);
  }

  // Verify: the employee and all owned records are gone.
  const stillThere = await Employee.findOne({ employeeId: employeeIdArg });
  const remaining = stillThere ? await countEmployeeRecords(stillThere) : null;
  console.log('\n=== Verification ===');
  console.log(`  employee record exists: ${stillThere ? 'YES (FAILED)' : 'no'}`);
  if (remaining) {
    console.log('  remaining owned records:', JSON.stringify(remaining));
  } else {
    console.log('  remaining owned records: none');
  }
  console.log(
    stillThere ? '\nDELETE FAILED — employee still present.' : '\nDELETE VERIFIED — employee fully removed.'
  );

  await mongoose.disconnect();
  process.exit(stillThere ? 1 : 0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
