import nodemailer from 'nodemailer';
import Employee from '../models/Employee.js';
import {
  leaveAppliedEmployeeTemplate,
  leaveAppliedAdminTemplate,
  leaveStatusUpdateTemplate,
} from '../templates/emailTemplates.js';

let transporter;

const REQUIRED_ADMIN_RECIPIENTS = [
  'charan.f.sde@gmail.com',
  'rajan.kumar@premindustries.in',
];

const extractDisplayName = (from = '') => {
  const match = String(from).match(/^"?([^"<]+?)"?\s*</);
  return match?.[1]?.trim() || 'Prem Industries';
};

const mailFrom = () => {
  const smtpUser = process.env.SMTP_USER;
  if (!smtpUser) return process.env.MAIL_FROM || '';

  // SMTP providers such as Gmail commonly reject arbitrary From addresses.
  // Keep the configured display name, but send from the authenticated mailbox.
  const displayName = extractDisplayName(process.env.MAIL_FROM);
  return `"${displayName}" <${smtpUser}>`;
};

const getTransporter = () => {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
};

const sendMail = async ({ to, subject, html }) => {
  try {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log(`[Email-skip] Missing SMTP auth. To:${to} Subject:${subject}`);
      return { skipped: true };
    }
    const info = await getTransporter().sendMail({
      from: mailFrom(),
      to,
      subject,
      html,
    });
    console.log(`[Email-sent] To:${to} Subject:${subject} MessageId:${info.messageId}`);
    return info;
  } catch (err) {
    console.error(`Email error for ${to}:`, err.message);
    return { error: err };
  }
};

const configuredAdminRecipients = () => [
  ...new Set(
    [
      ...REQUIRED_ADMIN_RECIPIENTS,
      ...(process.env.ADMIN_EMAIL || '').split(','),
    ]
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  ),
];

export const sendLeaveAppliedEmails = async ({ employee, leave }) => {
  const tasks = [];

  if (employee.email) {
    tasks.push(sendMail({
      to: employee.email,
      subject: 'Leave Application Submitted',
      html: leaveAppliedEmployeeTemplate({ employee, leave }),
    }));
  }

  let unique = configuredAdminRecipients();
  if (!unique.length) {
    const admins = await Employee.find({ role: 'admin', active: true })
      .select('email')
      .lean();
    unique = [
      ...new Set(
        admins
          .map((a) => a.email)
          .filter(Boolean)
          .map((e) => e.toLowerCase())
      ),
    ];
  }

  if (unique.length) {
    tasks.push(sendMail({
      to: unique.join(','),
      subject: `New Leave Request - ${employee.name}`,
      html: leaveAppliedAdminTemplate({ employee, leave }),
    }));
  }

  const results = await Promise.all(tasks);
  const failed = results.filter((result) => result?.error);
  if (failed.length) {
    console.error(`Leave application email failures: ${failed.length}/${results.length}`);
  }
  return results;
};

export const sendLeaveStatusEmail = async ({ employee, leave }) => {
  if (!employee.email) {
    console.log(`[Email-skip] Employee has no email. Employee:${employee.employeeId || employee._id} Subject:Leave ${leave.status.toUpperCase()}`);
    return { skipped: true };
  }

  return sendMail({
    to: employee.email,
    subject: `Leave ${leave.status.toUpperCase()}`,
    html: leaveStatusUpdateTemplate({ employee, leave }),
  });
};

export default sendMail;
