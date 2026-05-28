import nodemailer from 'nodemailer';
import {
  leaveAppliedEmployeeTemplate,
  leaveAppliedAdminTemplate,
  leaveStatusUpdateTemplate,
  emailVerificationTemplate,
  weeklyHeadDigestTemplate,
  leaveApprovedHeadNoticeTemplate,
  leaveReversedTemplate,
} from '../templates/emailTemplates.js';

let transporter;

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

const notificationAddress = (person) => person?.notificationEmail || person?.email || '';

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

// Department-wise routing: applicant gets one confirmation; every active
// reviewer (multi-head aware) gets the actionable mail. Pass either `approver`
// (single) or `approvers` (array) — the controller chooses based on whether
// the department has multiple heads.
export const sendLeaveAppliedEmails = async ({ employee, leave, approver, approvers }) => {
  const reviewerList = Array.isArray(approvers) && approvers.length
    ? approvers
    : approver
      ? [approver]
      : [];
  const tasks = [];

  if (employee.email) {
    tasks.push(sendMail({
      to: employee.email,
      subject: 'Leave Application Submitted',
      html: leaveAppliedEmployeeTemplate({ employee, leave }),
    }));
  }

  const reviewersWithEmail = reviewerList.filter((r) => r?.email);
  for (const reviewer of reviewersWithEmail) {
    tasks.push(sendMail({
      to: reviewer.email,
      subject: `New Leave Request - ${employee.name}`,
      html: leaveAppliedAdminTemplate({ employee, leave, approver: reviewer }),
    }));
  }
  if (!reviewersWithEmail.length) {
    console.warn(`[Email-warn] No reviewer email for leave ${leave._id} by ${employee.employeeId}`);
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

export const sendVerificationCodeEmail = async ({ employee, code, expiresInMinutes }) => {
  if (!employee.email) return { skipped: true };
  return sendMail({
    to: employee.email,
    subject: 'Verify your email - Prem Industries Leave Portal',
    html: emailVerificationTemplate({ employee, code, expiresInMinutes }),
  });
};

// Notify the employee's mapped Head group when a dept_head approves leave.
// Heads get actionable mail because they retain the ability to overturn the
// approval before the leave start date.
export const sendLeaveApprovedHeadNotice = async ({ heads, employee, leave, approvedBy }) => {
  const tasks = heads
    .map((head) => ({ head, to: notificationAddress(head) }))
    .filter(({ to }) => to)
    .map(({ head, to }) =>
      sendMail({
        to,
        subject: `Leave Approved by Dept Head - ${employee.name}`,
        html: leaveApprovedHeadNoticeTemplate({ head, employee, leave, approvedBy }),
      })
    );
  if (!tasks.length) {
    console.warn(`[Email-warn] No head email to notify for leave ${leave._id} by ${employee.employeeId}`);
    return [];
  }
  return Promise.all(tasks);
};

// Sent when a head overturns a previously approved leave. Employee learns
// their leave is off; the original dept_head learns their approval was
// overruled (so they can update the team).
export const sendLeaveReversedEmail = async ({ employee, originalApprover, leave, reversedBy }) => {
  const tasks = [];
  if (employee.email) {
    tasks.push(sendMail({
      to: employee.email,
      subject: 'Leave Approval Overturned',
      html: leaveReversedTemplate({
        recipientName: employee.name,
        employee,
        leave,
        reversedBy,
        wasOriginalApprover: false,
      }),
    }));
  }
  if (originalApprover?.email && originalApprover._id?.toString() !== reversedBy?._id?.toString()) {
    tasks.push(sendMail({
      to: originalApprover.email,
      subject: `Your Approval Overturned - ${employee.name}`,
      html: leaveReversedTemplate({
        recipientName: originalApprover.name,
        employee,
        leave,
        reversedBy,
        wasOriginalApprover: true,
      }),
    }));
  }
  return Promise.all(tasks);
};

export const sendWeeklyHeadDigestEmail = async ({ head, weekStart, weekEnd, leaves }) => {
  const to = notificationAddress(head);
  if (!to) return { skipped: true };
  return sendMail({
    to,
    subject: `Weekly Approved Leave Roster - ${weekStart.toLocaleDateString()} to ${weekEnd.toLocaleDateString()}`,
    html: weeklyHeadDigestTemplate({ head, weekStart, weekEnd, leaves }),
  });
};

export { sendMail };
export default sendMail;
