import nodemailer from 'nodemailer';
import {
  leaveAppliedEmployeeTemplate,
  leaveAppliedAdminTemplate,
  leaveStatusUpdateTemplate,
} from '../templates/emailTemplates.js';

let transporter;

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
    if (!process.env.SMTP_USER) {
      console.log(`[Email-skip] To:${to} Subject:${subject}`);
      return;
    }
    await getTransporter().sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
    });
  } catch (err) {
    console.error('Email error:', err.message);
  }
};

export const sendLeaveAppliedEmails = async ({ employee, leave }) => {
  await sendMail({
    to: employee.email,
    subject: 'Leave Application Submitted',
    html: leaveAppliedEmployeeTemplate({ employee, leave }),
  });
  if (process.env.ADMIN_EMAIL) {
    await sendMail({
      to: process.env.ADMIN_EMAIL,
      subject: `New Leave Request - ${employee.name}`,
      html: leaveAppliedAdminTemplate({ employee, leave }),
    });
  }
};

export const sendLeaveStatusEmail = async ({ employee, leave }) => {
  await sendMail({
    to: employee.email,
    subject: `Leave ${leave.status.toUpperCase()}`,
    html: leaveStatusUpdateTemplate({ employee, leave }),
  });
};

export default sendMail;
