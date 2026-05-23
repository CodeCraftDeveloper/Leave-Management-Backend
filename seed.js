import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from './config/db.js';
import Employee from './models/Employee.js';
import Leave from './models/Leave.js';
import Notification from './models/Notification.js';
import Holiday from './models/Holiday.js';

dotenv.config();

const TEMP_PASSWORD = 'Password@123';

const titleCase = (s) =>
  s
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');

const knownEmails = {
  H666: 'pappumahato000@gmail.com',
  H602: 'dishantmishra11092000@gmail.com',
};

const roster = [
  { employeeId: 'H1',    name: 'HARENDRA PRATAP SINGH',   department: 'Unit Head',              designation: 'Unit Head' },
  { employeeId: 'H694',  name: 'DILEEP SINGH CHANDEL',    department: 'Production',             designation: 'Production' },
  { employeeId: 'H2',    name: 'SHRI PRAKASH SINGH',      department: 'Maintenance',            designation: 'Maintenance' },
  { employeeId: 'H4',    name: 'SATENDRA KUMAR KATIYAR',  department: 'Production',             designation: 'Production' },
  { employeeId: 'H336',  name: 'PAWAN KUMAR',             department: 'Production',             designation: 'Production' },
  { employeeId: 'H34',   name: 'RAJAN KUMAR',             department: 'HR & Admin',             designation: 'HR & Admin' },
  { employeeId: 'H482',  name: 'VIMLASH',                 department: 'HR',                     designation: 'HR' },
  { employeeId: 'H532',  name: 'RADHIKA RANI',            department: 'Accounts',               designation: 'Accounts' },
  { employeeId: 'H317',  name: 'PRAVEEN KUMAR',           department: 'Accounts',               designation: 'Accounts' },
  { employeeId: 'H545',  name: 'BHARAT BHUSHAN',          department: 'Accounts',               designation: 'Accounts' },
  { employeeId: 'H704',  name: 'SATISH KUMAR',            department: 'Accounts',               designation: 'Accounts' },
  { employeeId: 'H376',  name: 'GAURAV KUMAR',            department: 'E-com',                  designation: 'E-com' },
  { employeeId: 'H495',  name: 'REKHA CHINDALIYA',        department: 'E-com',                  designation: 'E-com' },
  { employeeId: 'H616',  name: 'ABHAY',                   department: 'E-com',                  designation: 'E-com' },
  { employeeId: 'H624',  name: 'EKTA KUMARI',             department: 'Pre-Press',              designation: 'Pre-Press' },
  { employeeId: 'H641',  name: 'Shikhar Tripathi',        department: 'Digital Market',         designation: 'Digital Marketing' },
  { employeeId: 'H666',  name: 'CHANDI CHARAN MAHATO',    department: 'Digital Market',         designation: 'Digital Marketing' },
  { employeeId: 'H386',  name: 'PRADEEP',                 department: 'Digital Market',         designation: 'Digital Marketing' },
  { employeeId: 'H602',  name: 'DISHANT MISHRA',          department: 'Digital Market',         designation: 'Digital Marketing' },
  { employeeId: 'H689',  name: 'KARAMJEET KUMAR',         department: 'Digital Market',         designation: 'Digital Marketing' },
  { employeeId: 'RH242', name: 'KISHAN',                  department: 'Billing',                designation: 'Billing' },
  { employeeId: 'H701',  name: 'VISHAL',                  department: 'EPR',                    designation: 'EPR' },
  { employeeId: 'H568',  name: 'UDHAM SINGH',             department: 'Store',                  designation: 'Store' },
  { employeeId: 'H103',  name: 'GAURAV KUMAR',            department: 'Store',                  designation: 'Store' },
  { employeeId: 'H371',  name: 'VIKRANT SHISHODIA',       department: 'Store',                  designation: 'Store' },
  { employeeId: 'H620',  name: 'KAMAL YADAV',             department: 'Store',                  designation: 'Store' },
  { employeeId: 'H569',  name: 'HIMANSHU PRAJAPATI',      department: 'Store-Deo',              designation: 'Store-Deo' },
  { employeeId: 'H60',   name: 'OMENDRA PAL SINGH',       department: 'Dispatch',               designation: 'Supervisor (Dispatch)' },
  { employeeId: 'RH277', name: 'AKSHAY VAIDWAN',          department: 'Dispatch',               designation: 'Supervisor (Dispatch)' },
  { employeeId: 'H172',  name: 'ASHWANI TYAGI',           department: 'Production',             designation: 'Supervisor (Production)' },
  { employeeId: 'H241',  name: 'SATENDRA SINGH',          department: 'Production',             designation: 'Supervisor (Production)' },
  { employeeId: 'H354',  name: 'ROOP CHAND',              department: 'Production',             designation: 'Supervisor (Production)' },
  { employeeId: 'H601',  name: 'SANDEEP KUMAR',           department: 'Production',             designation: 'Supervisor (Production)' },
];

const run = async () => {
  await connectDB();

  console.log('Clearing existing data...');
  await Promise.all([
    Employee.deleteMany(),
    Leave.deleteMany(),
    Notification.deleteMany(),
    Holiday.deleteMany(),
  ]);

  // Drop old indexes so the new sparse-unique email index can be rebuilt
  // (a pre-existing non-sparse unique index would reject multiple emailless docs).
  try {
    await Employee.collection.dropIndexes();
  } catch {
    /* collection may not exist yet on a fresh DB */
  }
  await Employee.syncIndexes();

  console.log('Seeding official holidays...');
  const currentYear = new Date().getFullYear();
  await Holiday.create([
    { name: "New Year's Day", date: new Date(`${currentYear}-01-01`), description: 'Beginning of the new year' },
    { name: 'Republic Day', date: new Date(`${currentYear}-01-26`), description: 'Republic Day of India' },
    { name: 'Independence Day', date: new Date(`${currentYear}-08-15`), description: 'Independence Day of India' },
    { name: 'Gandhi Jayanti', date: new Date(`${currentYear}-10-02`), description: "Mahatma Gandhi's Birthday" },
    { name: 'Christmas Day', date: new Date(`${currentYear}-12-25`), description: 'Christmas celebration' },
  ]);

  console.log('Seeding admin...');
  await Employee.create({
    employeeId: 'ADMIN001',
    name: 'Admin User',
    email: 'charan.f.sde@gmail.com',
    password: 'admin123',
    department: 'Management',
    designation: 'HR Admin',
    role: 'admin',
  });

  console.log(`Seeding ${roster.length} employees with temp password "${TEMP_PASSWORD}"...`);
  for (const entry of roster) {
    const doc = {
      employeeId: entry.employeeId,
      name: titleCase(entry.name),
      password: TEMP_PASSWORD,
      department: entry.department,
      designation: entry.designation,
      role: 'employee',
    };
    const email = knownEmails[entry.employeeId];
    if (email) doc.email = email;
    await Employee.create(doc);
  }

  console.log('\nSeed complete');
  console.log(`Admin -> charan.f.sde@gmail.com / admin123`);
  console.log(`Employees -> <CardNo> / ${TEMP_PASSWORD} (e.g. H1 / ${TEMP_PASSWORD})`);
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
