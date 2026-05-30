import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import connectDB from './config/db.js';
import Employee from './models/Employee.js';
import Department from './models/Department.js';
import Leave from './models/Leave.js';
import Attendance from './models/Attendance.js';
import Notification from './models/Notification.js';
import Holiday from './models/Holiday.js';

dotenv.config();

const TEMP_PASSWORD = 'Password@123';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_EMPLOYEE_WORKBOOK = path.resolve(__dirname, '../Employee_Seed_Template.xlsx');
const EMPLOYEE_WORKBOOK = process.env.EMPLOYEE_SEED_WORKBOOK
  ? path.resolve(process.env.EMPLOYEE_SEED_WORKBOOK)
  : DEFAULT_EMPLOYEE_WORKBOOK;

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

const DEFAULT_HEAD_EMAILS = [
  'charan.f.sde@gmail.com',
  'rajan.kumar@premindustries.in',
  'hp.singh@premindustries.in',
  'saurabh@premindustries.in',
  'raghav.goel@premindustries.in',
  'ishita.goel@premindustries.in',
  'satendra.katiyar@premindustries.in',
  'sp.singh@premindustries.in',
  'production.premindustries@gmail.com',
  'dileep.singh@premindustries.in',
];

const HEAD_EMAILS = Object.freeze({
  primary: 'charan.f.sde@gmail.com',
  rajan: 'rajan.kumar@premindustries.in',
  hp: 'hp.singh@premindustries.in',
  saurabh: 'saurabh@premindustries.in',
  raghav: 'raghav.goel@premindustries.in',
  ishita: 'ishita.goel@premindustries.in',
  satendra: 'satendra.katiyar@premindustries.in',
  sp: 'sp.singh@premindustries.in',
  production: 'production.premindustries@gmail.com',
  dileep: 'dileep.singh@premindustries.in',
});

const departmentHeadIds = new Set(['H641', 'H697', 'H59', 'H633']);

const rosterFromText = (text) =>
  text
    .trim()
    .split('\n')
    .map((line) => {
      const [employeeId, name, department, designation, headEmails] = line.split('|').map((part) => part.trim());
      return {
        employeeId,
        name,
        department,
        designation: designation || department,
        headEmailsRaw: headEmails || '',
      };
    });

const fallbackRoster = rosterFromText(`
H1|HARENDRA PRATAP SINGH|Unit Head
H694|DILEEP SINGH CHANDEL|Production
H2|SHRI PRAKASH SINGH|Maintenance
H4|SATENDRA KUMAR KATIYAR|Production
H336|PAWAN KUMAR|Production
H34|RAJAN KUMAR|HR & Admin
H482|VIMLASH|HR
H532|RADHIKA RANI|Accounts
H317|PRAVEEN KUMAR|Accounts
H545|BHARAT BHUSHAN|Accounts
H704|SATISH KUMAR|Accounts
H495|REKHA CHINDALIYA|E-com
H616|ABHAY|E-com
H624|EKTA KUMARI|Pre Press
H641|Shikhar Tripathi|Digital Market|Digital Marketing
H666|CHANDI CHARAN MAHATO|Digital Market|Digital Marketing
H386|PRADEEP|Digital Market|Digital Marketing
H602|DISHANT MISHRA|Digital Market|Digital Marketing
H689|KARAMJEET KUMAR|Digital Market|Digital Marketing
RH242|KISHAN|Billing
H701|VISHAL|EPR
H568|UDHAM SINGH|Store
H103|GAURAV KUMAR|Store
H371|VIKRANT SHISHODIA|Store
H620|KAMAL YADAV|Store
H569|HIMANSHU PRAJAPATI|Store-Deo
H60|OMENDRA PAL SINGH|Dispatch|Supervisor (Dispatch)
RH277|AKSHAY VAIDWAN|Dispatch|Supervisor (Dispatch)
H172|ASHWANI TYAGI|Production|Supervisor (Production)
H241|SATENDRA SINGH|Production|Supervisor (Production)
H354|ROOP CHAND|Production|Supervisor (Production)
H601|SANDEEP KUMAR|Production|Supervisor (Production)
H308|VIVEK MISHRA|Supervisor Ink
H612|SRIJAN THAPLIYAL|Supervisor Ink
H91|SANTOSH KUMAR MISHRA|PPC
H696|SUBODH KUMAR|PPC
H370|HIMANSHU|PPC
H582|VIJAYENDRA SINGH TOMAR|PPC-Deo
H48|RAJESH CHAUHAN|PPC-Deo
H135|AMIT KUMAR GUPTA|Maintenance
H137|FAIYAZ KHAN|Maintenance-Metrical
H179|SATISH KUMAR|Maintenance-Metrical
H337|BIKAS PASWAN|Maintenance-Metrical
H527|KAUSHLENDRA KUMAR|Maintenance-Metrical
H604|RAVINDRA|Maintenance-Metrical
H63|SUNIL KUMAR|Maintenance-Metrical
H131|SHIVAM KUMAR PATHAK|Maintenance-Mechanical
H149|RAHUL KUSHWAHA|Maintenance-Mechanical
H590|PRASHANT KUMAR|Maintenance-Mechanical
H724|SANJAY SHARMA|Maintenance-Mechanical
H470|RITESH NISHAD|Maintenance-Mechanical
H471|SAURABH|Maintenance-Mechanical
H637|RAVINDRA YADAV|Maintenance-Mechanical
H7|YOGESH KUMAR|Printing-Cylinder
H141|DHARMENDRA SINGH|Printing-Cylinder
H404|MANVENDRA SINGH|Printing-Cylinder
H437|RITESH YADAV|Printing-01
H539|VIMAL KUMAR|Printing-01
H599|AKHILESH KUMAR|Printing-01
H508|GOPAL|Printing-01
H509|DINESH KUMAR|Printing-01
H575|SANTOSH KUMAR YADAV|Printing-01
H504|ASHISH KUMAR|Printing-02
H357|GOURAV TIWARI|Printing-02
H451|SACHIN|Printing-02
H420|ANKIT KUMAR|Printing-02
H401|RAHUL KUMAR|Printing-02
H498|VIRENDRA PAL|Printing Ink
H501|RAHUL KUMAR|Printing Ink
H573|AJIT KUMAR|Printing Ink
H554|KHYATI PRASAD|Printing Ink
H538|RAVINDER KUMAR|Printing Ink
H650|AMIT KUMAR|Printing Ink
H682|AMIT KUMAR PANDEY|Printing Ink
H658|HARISH CHAND RAWAT|Printing Incharge
H505|RAMDEEN|Printing Incharge
H697|MUNIB YADAV|Printing-01
H638|PRASHANT|Printing-02
H678|PAWAN KUMAR|Printing-02
H603|RAHUL|Printing-02
H703|ASHUTOSH|Printing-01
H700|RAVI KUMAR|Printing-02
H16|ANKUR CHAUDHARY|Extrusion
H37|AMARNATH SINGH|Extrusion
H200|SHISHU LAL KUMAR|Extrusion
H497|DAYANAND|Extrusion
H628|AMRENDRA|Extrusion
H20|PRAVEEN KUMAR|Inspection
H70|RAVI KUMAR|Inspection
H530|RAKESH KUMAR|Inspection
H65|SARVESH KUMAR|Inspection
H691|SACHIN|Inspection
H59|DEEPAK BISHT|Lamination - SOLVENT LESS
H721|SATENDRA KUMAR|Lamination - SOLVENT LESS
H225|SACHIN SHARMA|Lamination - SOLVENT LESS
H92|SONU KUMAR|Lamination - SOLVENT LESS
H723|PRAVEEN KUMAR|Lamination - SOLVENT LESS
H625|VIKASH KUMAR|Lamination - SOLVENT LESS
H621|VIKASH KUMAR|Lamination - SOLVENT LESS
H679|BIRJU|Lamination - SOLVENT LESS
H607|SURAJ RAM|Lamination - SOLVENT LESS
H147|POOJA PRAKASH|Lamination - NARENDA
H684|NAVEEN KUMAR|Lamination - NARENDA
H690|ANISH MISHRA|Lamination - NARENDA
H677|KANIRAM|Lamination - NARENDA
H56|VIPIN PANDIT|Lamination - SOLVENT LESS
H548|ATUL KUMAR|Lamination - SOLVENT BASE
H537|SURENDRA KUMAR YADAV|Lamination - SOLVENT BASE
H536|SUNIL KUMAR SHARMA|Lamination - NARENDA
H574|SANJAY SINGH|Lamination - SOLVENT BASE
H557|DIWAKAR NISHAD|Lamination - SOLVENT BASE
H645|VIPIN PRAJAPATI|Lamination - SOLVENT BASE
H676|PRABHAKAR|Lamination - SOLVENT BASE
H692|KAPIL KUMAR|Lamination - SOLVENT LESS
H698|VIKAS KUMAR|Lamination - SOLVENT BASE
H699|UTTAM SINGH|Lamination - SOLVENT LESS
H706|SANJAY KUMAR SINGH|Lamination - NARENDA
H51|PRAMOD SINGH SIKARWAR|Slitting
H62|ROOPENDRA KUMAR|Slitting
H516|TEJVEER SINGH|Slitting
H39|PUSHPENDRA KUMAR|Slitting
H142|LAKSHMAN YADAV|Slitting
H669|VINOD KUMAR|Slitting
H358|SACHIN|Slitting
H462|SAURABH KUMAR|Slitting
H402|VINIT KUMAR|Slitting
H406|AMIT KUMAR|Slitting
H510|MUKESH|Slitting
H512|PRAVESH KUMAR|Slitting
H572|SHAILENDRA|Slitting
H582A|SURYA KANT NIRALA|Slitting
H594|AJAD GAURAV|Slitting
H596|KAMAL SINGH|Slitting
H503|RANJAN KUMAR|Slitting
H689A|NEERAJ|Slitting
H711|SANDEEP KUMAR|Quality
H527A|SUNIL KUMAR|Quality
H533|NEERAJ KUMAR SINGH|Quality
H342|AMAN RAJPAL|Quality
H579|ANKIT|Quality
H581|PRADEEP KUMAR|Quality
H583|RAJESH KUMAR|Quality
H587|DHEERENDRA SINGH|Quality
H631|RAMESH KUMAR|Quality
H654|VIPIN|Quality
H664|PRAJWAL ANIL RUKAR|Quality
H710|JAGAT SINGH|Quality
H560|DIPOO KUMAR|Pouch
H57|MOHAN MALIK|Pouch
H86|KAPIL|Pouch
H96|AMZAD KHAN|Pouch
H107|MOHIT|Pouch
H95|AVINASH|Pouch
H101|SHAKTI SINGH|Pouch
H106|LALIT KUMAR SHARMA|Pouch
H104|SACHIN KUMAR|Pouch
H121|ASHWANI KUMAR|Pouch
H132|DHARMENDRA MANDI|Pouch
H128|ARUN SINGAL|Pouch
H124|MUNNA KUMAR|Pouch
H111|YAMIN|Pouch
H123|RAM YADAV|Pouch
H144|PARAS|Pouch
H444|RAVI INDRA PRASAD|Pouch
H564|YASH KUMAR|Pouch
H526|RITESH SINGH|Pouch
H150|RAMESH|Pouch
H140|VIRENDRA|Pouch
H130|GAURAV KUMAR|Pouch
H541|ROHIT KUMAR|Pouch
H655|JITENDRA SINGH|Pouch
H657|LOKESH KUMAR TOMAR|Pouch
RH227|DEEPAK KUMAR|Pouch
H661|RAVI KUMAR|Pouch
H663|SAURABH KUMAR|Pouch
H665|SOHAN PAL|Pouch
RH244|KAPIL KUMAR|Pouch
H705|SACHIN KUMAR|Pouch
H707|SHUBHAM|Pouch
H712|YATISH|Pouch
H728|RANJAN|Pouch
H626|VIPIN KUMAR|Pantry
H653|DEEPAK KUMAR|Pantry
H465|ASHISH YADAV|Fomfit
H695|RAVIKANT|Fomfit
H688|RADHE MOHAN|Fomfit
H367|SURYA NATH MISHRA|Warehouse
H72|SURESH SINGH|Warehouse
H713|DEV RATAN TIWARI|Extrusion
H714|ROHIT|Pouch
H715|NITISH KUMAR|Maintenance
H716|ANIL KUMAR|Fomfit
H722|ASHUTOSH GAUTAM|Maintenance
H520|SULTAN SINGH|Driver
H500|BRIJESH|Driver
H670|GAJENDRA|Driver
H112|MOHAN|Blown Film
H118|RAMAN|Blown Film
H100|SUNIL KUMAR|Blown Film
H273|BHARAT PRASAD|Blown Film - Recycle
H717|UMESH KUMAR|Blown Film - Unit - 4
H718|SHOBHIT|Blown Film - Unit - 4
H719|JITENDRA KUMAR|Blown Film - Unit - 4
H720|VINAY SINGH CHAUCHAN|Blown Film - Unit - 4
`);

const normalizeCell = (value) => {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (value.text) return String(value.text).trim();
    if (value.result) return String(value.result).trim();
    if (value.richText) return value.richText.map((part) => part.text).join('').trim();
  }
  return String(value).trim();
};

const parseBoolean = (value, fallback = false) => {
  const normalized = normalizeCell(value).toLowerCase();
  if (!normalized) return fallback;
  return ['true', 'yes', 'y', '1', 'active', 'verified'].includes(normalized);
};

const parseNumber = (value, fallback = undefined) => {
  const normalized = normalizeCell(value).replace(/,/g, '');
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseDate = (value) => {
  if (!value) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const normalized = normalizeCell(value);
  if (!normalized) return undefined;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const normalizeEmail = (value) => {
  const normalized = normalizeCell(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
};

const extractEmails = (value) => {
  const raw = normalizeCell(value);
  if (!raw) return [];

  return raw
    .split(/[\/,;\s]+/)
    .map(normalizeEmail)
    .filter(Boolean);
};

const displayNameFromEmail = (email) => {
  const localPart = email.split('@')[0] || 'head';
  return titleCase(localPart.replace(/[._-]+/g, ' '));
};

const isPrimaryHeadEmail = (email) => email === 'charan.f.sde@gmail.com';

const inferredHeadEmailsForDepartment = (department = '') => {
  const dept = normalizeCell(department).toLowerCase();

  if (!dept) return [HEAD_EMAILS.rajan];
  if (dept.includes('digital market')) return [HEAD_EMAILS.rajan, HEAD_EMAILS.raghav, HEAD_EMAILS.ishita];
  if (
    dept.includes('hr') ||
    dept.includes('admin') ||
    dept.includes('account') ||
    dept.includes('e-com') ||
    dept.includes('pre press')
  ) {
    return [HEAD_EMAILS.rajan, HEAD_EMAILS.saurabh];
  }
  if (dept === 'maintenance') return [HEAD_EMAILS.rajan, HEAD_EMAILS.hp];
  if (dept.includes('maintenance')) return [HEAD_EMAILS.sp];
  if (dept.includes('ppc')) return [HEAD_EMAILS.satendra];
  if (
    dept.includes('printing') ||
    dept.includes('extrusion') ||
    dept.includes('inspection') ||
    dept.includes('lamination') ||
    dept.includes('slitting')
  ) {
    return [HEAD_EMAILS.production, HEAD_EMAILS.satendra];
  }
  if (dept.includes('quality') || dept.includes('blown film')) return [HEAD_EMAILS.dileep];
  if (dept.includes('pouch')) return [HEAD_EMAILS.sp];
  if (dept.includes('production')) return [HEAD_EMAILS.rajan, HEAD_EMAILS.hp];

  return [HEAD_EMAILS.rajan];
};

const headEmailsForEntry = (entry) => {
  const explicit = [
    ...(Array.isArray(entry.headEmails) ? entry.headEmails : []),
    ...extractEmails(entry.headEmailsRaw),
  ];
  const source = explicit.length ? explicit : inferredHeadEmailsForDepartment(entry.department);
  return [...new Set(source.map(normalizeEmail).filter(Boolean))];
};

const readWorkbookRoster = async () => {
  if (!fs.existsSync(EMPLOYEE_WORKBOOK)) return [];

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EMPLOYEE_WORKBOOK);
  const worksheet = workbook.getWorksheet('Employee_Data') || workbook.worksheets[0];
  if (!worksheet) return [];

  const headerRow = worksheet.getRow(1);
  const headers = {};
  headerRow.eachCell((cell, columnNumber) => {
    const key = normalizeCell(cell.value);
    if (key) headers[key] = columnNumber;
  });

  const getRawCell = (row, key) => (headers[key] ? row.getCell(headers[key]).value : undefined);
  const getCell = (row, key) => normalizeCell(getRawCell(row, key));
  const employees = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const employeeId = getCell(row, 'employeeId').toUpperCase();
    const name = getCell(row, 'name');
    if (!employeeId || !name) return;

    employees.push({
      employeeId,
      name,
      email: '',
      headEmails: extractEmails(getRawCell(row, 'email')),
      password: getCell(row, 'password') || TEMP_PASSWORD,
      department: getCell(row, 'department') || 'General',
      designation: getCell(row, 'designation') || getCell(row, 'department') || 'Employee',
      role: getCell(row, 'role') || undefined,
      phone: getCell(row, 'phone') || undefined,
      address: getCell(row, 'address') || undefined,
      joiningDate: parseDate(getRawCell(row, 'joiningDate')),
      monthlySalary: parseNumber(getRawCell(row, 'monthlySalary')),
      status: getCell(row, 'status') || 'ACTIVE',
      emailVerified: parseBoolean(getRawCell(row, 'emailVerified'), false),
    });
  });

  const isOnlyTemplateSample =
    employees.length === 1 &&
    employees[0].employeeId === 'H999' &&
    normalizeCell(employees[0].name).toLowerCase() === 'sample employee';

  return isOnlyTemplateSample ? [] : employees;
};

const resolveRoster = async () => {
  const workbookRoster = await readWorkbookRoster();
  if (workbookRoster.length) {
    console.log(`Loaded ${workbookRoster.length} employees from ${EMPLOYEE_WORKBOOK}`);
    return workbookRoster;
  }
  console.log(`No filled employee workbook found at ${EMPLOYEE_WORKBOOK}; using fallback roster.`);
  return fallbackRoster;
};

const uniqueEmailSet = (entries) => {
  const counts = new Map();
  for (const entry of entries) {
    const email = normalizeEmail(entry.email);
    if (!email) continue;
    counts.set(email, (counts.get(email) || 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count === 1).map(([email]) => email));
};

const assertUniqueEmployeeIds = (entries) => {
  const seen = new Set();
  const duplicates = new Set();
  for (const entry of entries) {
    if (seen.has(entry.employeeId)) duplicates.add(entry.employeeId);
    seen.add(entry.employeeId);
  }
  if (duplicates.size) {
    throw new Error(`Duplicate employeeId values in seed roster: ${[...duplicates].join(', ')}`);
  }
};

const validRoles = new Set(['employee', 'dept_head', 'head', 'hr']);

const buildHeadSeeds = (roster) => {
  const headEmails = new Set(DEFAULT_HEAD_EMAILS.map(normalizeEmail).filter(Boolean));

  for (const entry of roster) {
    for (const email of headEmailsForEntry(entry)) {
      headEmails.add(email);
    }
  }

  return [...headEmails].map((email, index) => ({
    employeeId: `HEAD${String(index + 1).padStart(3, '0')}`,
    name: isPrimaryHeadEmail(email) ? 'Head User' : displayNameFromEmail(email),
    sourceEmail: email,
    email: isPrimaryHeadEmail(email) ? email : undefined,
    notificationEmail: email,
    password: isPrimaryHeadEmail(email) ? 'admin123' : TEMP_PASSWORD,
    department: 'Management',
    designation: 'Head',
  }));
};

const departmentCodeFromName = (name) =>
  normalizeCell(name)
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);

const buildDepartmentGroups = (roster, headByEmail) => {
  const groups = new Map();

  for (const entry of roster) {
    const name = normalizeCell(entry.department) || 'General';
    if (!groups.has(name)) {
      groups.set(name, {
        name,
        code: departmentCodeFromName(name),
        headIds: new Set(),
        headEmails: new Set(),
        memberCount: 0,
      });
    }

    const group = groups.get(name);
    group.memberCount += 1;
    for (const email of headEmailsForEntry(entry)) {
      const normalized = normalizeEmail(email);
      const head = headByEmail.get(normalized);
      if (!head) continue;
      group.headIds.add(String(head._id));
      group.headEmails.add(normalized);
    }
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
};

const utcDay = (year, month, day, hour = 0, minute = 0) =>
  new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

const istTime = (year, month, day, hour, minute) =>
  new Date(Date.UTC(year, month - 1, day, hour - 5, minute - 30, 0, 0));

const seedH666MayRecords = async ({ employeeById, actor, year }) => {
  const employee = employeeById.get('H666');
  if (!employee) {
    throw new Error('Cannot seed H666 May records because employee H666 was not created.');
  }

  const approver = employeeById.get('H641') || actor;
  const fullLeaveDays = new Set([12, 13, 14, 15, 16]);
  const halfLeaveSessions = new Map([
    [5, 'first_half'],
    [18, 'first_half'],
    [29, 'second_half'],
  ]);
  const halfLeaveDays = new Set(halfLeaveSessions.keys());
  const attendanceDocs = [];
  const month = 5;
  const seedAttendanceThroughDay = 29;

  await Leave.create([
    {
      employee: employee._id,
      approver: approver?._id,
      leaveType: 'leave',
      startDate: utcDay(year, month, 12),
      endDate: utcDay(year, month, 16),
      totalDays: 5,
      reason: 'Seeded full-day leave for May 12 to May 16.',
      status: 'approved',
      adminComment: 'Seeded approved leave.',
      actionedBy: approver?._id,
      actionedAt: new Date(),
    },
    ...[...halfLeaveSessions].map(([day, halfDaySession]) => ({
      employee: employee._id,
      approver: approver?._id,
      leaveType: 'leave',
      startDate: utcDay(year, month, day),
      endDate: utcDay(year, month, day),
      totalDays: 0.5,
      reason: `Seeded half-day leave for May ${day}.`,
      status: 'approved',
      adminComment: 'Seeded approved half-day leave.',
      actionedBy: approver?._id,
      actionedAt: new Date(),
      isHalfDay: true,
      halfDaySession,
    })),
  ]);

  for (let day = 1; day <= seedAttendanceThroughDay; day += 1) {
    if (fullLeaveDays.has(day)) continue;

    attendanceDocs.push({
      employee: employee._id,
      date: utcDay(year, month, day),
      checkIn: {
        time: istTime(year, month, day, 9, 15),
        latitude: 0,
        longitude: 0,
      },
      checkOut: {
        time: istTime(year, month, day, 18, 30),
        latitude: 0,
        longitude: 0,
      },
      totalHours: 9.25,
      workHours: 9.25,
      overtimeHours: 0,
      lateMinutes: 0,
      status: 'PRESENT',
      remarks: halfLeaveDays.has(day)
        ? 'Seeded present attendance with approved half-day leave'
        : 'Seeded present attendance',
      createdBy: approver?._id,
      updatedBy: approver?._id,
    });
  }

  await Attendance.insertMany(attendanceDocs);
  console.log(`Seeded H666 May ${year}: 5 full leave day(s), ${halfLeaveSessions.size} half leave day(s), ${attendanceDocs.length} present attendance day(s).`);
};

const run = async () => {
  const roster = await resolveRoster();
  assertUniqueEmployeeIds(roster);

  // Heads: top-of-org reviewers. They do not apply for leave themselves; they
  // approve dept_head leaves, see the weekly digest, and manage dept_heads.
  const heads = buildHeadSeeds(roster);
  const uniqueEmails = uniqueEmailSet([
    ...heads,
    ...roster.map((entry) => ({
      ...entry,
      email: knownEmails[entry.employeeId],
    })),
  ]);

  await connectDB();

  console.log('Clearing existing data...');
  await Promise.all([
    Employee.deleteMany(),
    Department.deleteMany(),
    Leave.deleteMany(),
    Attendance.deleteMany(),
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

  console.log('Seeding heads...');
  const headByEmail = new Map();
  const headCredentials = [];
  for (const h of heads) {
    const { sourceEmail, ...headDoc } = h;
    // Only the primary admin email is reserved in Employee.email. The other
    // head-source emails stay free so the actual employee can register and OTP
    // verify that address on their own profile later.
    const created = await Employee.create({
      ...headDoc,
      role: 'head',
      emailVerified: Boolean(headDoc.email),
    });
    headByEmail.set(sourceEmail, created);
    headCredentials.push({
      email: sourceEmail,
      employeeId: created.employeeId,
      password: h.password,
    });
  }

  console.log('Seeding department head groups...');
  const departmentGroups = buildDepartmentGroups(roster, headByEmail);
  for (const group of departmentGroups) {
    await Department.create({
      name: group.name,
      code: group.code,
      description: `Seeded from employee roster. Head group: ${[...group.headEmails].join(', ') || 'none'}.`,
      heads: [...group.headIds],
      active: true,
    });
  }

  console.log(`Seeding ${roster.length} employees...`);
  const employeeById = new Map();
  for (const entry of roster) {
    const isDepartmentHead = departmentHeadIds.has(entry.employeeId);
    const explicitRole = normalizeCell(entry.role);
    const doc = {
      employeeId: entry.employeeId,
      name: titleCase(entry.name),
      password: entry.password || TEMP_PASSWORD,
      department: entry.department,
      designation: entry.designation,
      role: validRoles.has(explicitRole) ? explicitRole : isDepartmentHead ? 'dept_head' : 'employee',
      headNotificationEmails: headEmailsForEntry(entry),
    };

    for (const optionalField of ['phone', 'address', 'joiningDate', 'monthlySalary', 'status']) {
      if (entry[optionalField] !== undefined && entry[optionalField] !== '') {
        doc[optionalField] = entry[optionalField];
      }
    }

    const email = normalizeEmail(knownEmails[entry.employeeId] || entry.email);
    if (email && uniqueEmails.has(email)) {
      doc.email = email;
      // Per upgrade plan: only employees who already have an email on file at
      // seed time are grandfathered to verified. Everyone else must verify
      // via OTP after setting their email through the portal.
      doc.emailVerified = Boolean(knownEmails[entry.employeeId]) || Boolean(entry.emailVerified);
    }
    const created = await Employee.create(doc);
    employeeById.set(created.employeeId, created);
  }

  await seedH666MayRecords({
    employeeById,
    actor: headByEmail.get(HEAD_EMAILS.primary),
    year: currentYear,
  });

  console.log('\nSeed complete');
  console.log(`Head (primary) -> charan.f.sde@gmail.com / admin123`);
  console.log(`Seeded ${heads.length} head account(s); non-primary heads use HEAD### / ${TEMP_PASSWORD}`);
  console.log('Temporary head credentials:');
  for (const credential of headCredentials) {
    console.log(`  ${credential.email} -> ${credential.employeeId} / ${credential.password}`);
  }
  console.log(`Seeded ${departmentGroups.length} department group(s) with mapped heads.`);
  console.log(`Department Head -> H641 / ${TEMP_PASSWORD} (Shikhar Tripathi, Digital Market)`);
  console.log(`Employees -> <CardNo> / ${TEMP_PASSWORD} (e.g. H1 / ${TEMP_PASSWORD})`);
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
