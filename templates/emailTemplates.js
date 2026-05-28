import { leaveTypeLabel } from '../utils/leaveTypes.js';

const baseStyles = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1f2937;
  line-height: 1.6;
`;

const wrap = (content) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;background:#f3f4f6;padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
    <tr>
      <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px;text-align:center;color:#fff;">
        <h1 style="margin:0;font-size:22px;letter-spacing:0.3px;">Prem Industries</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:28px 24px;${baseStyles}">
        ${content}
      </td>
    </tr>
    <tr>
      <td style="padding:16px;text-align:center;font-size:12px;color:#9ca3af;background:#f9fafb;">
        &copy; ${new Date().getFullYear()} Prem Industries &middot; Automated message
      </td>
    </tr>
  </table>
</body>
</html>
`;

const detailsTable = (leave) => `
  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><b>Leave Type</b></td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${leaveTypeLabel(leave.leaveType)}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><b>Start Date</b></td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${new Date(leave.startDate).toLocaleDateString()}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><b>End Date</b></td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${new Date(leave.endDate).toLocaleDateString()}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><b>Total Days</b></td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${leave.totalDays}</td></tr>
    <tr><td style="padding:8px;"><b>Reason</b></td><td style="padding:8px;">${leave.reason}</td></tr>
  </table>
`;

export const leaveAppliedEmployeeTemplate = ({ employee, leave }) =>
  wrap(`
    <h2 style="margin-top:0;">Hi ${employee.name},</h2>
    <p>Your leave application has been submitted successfully and is pending review.</p>
    ${detailsTable(leave)}
    <p>You will be notified once it is approved or rejected.</p>
  `);

export const leaveAppliedAdminTemplate = ({ employee, leave, approver }) =>
  wrap(`
    <h2 style="margin-top:0;">Hi ${approver?.name?.split(' ')[0] || 'there'},</h2>
    <p><b>${employee.name}</b> (${employee.employeeId} &middot; ${employee.department}) submitted a leave request and is awaiting your review.</p>
    ${detailsTable(leave)}
    <p>Open the Leave Portal to approve or reject this request.</p>
  `);

export const emailVerificationTemplate = ({ employee, code, expiresInMinutes }) =>
  wrap(`
    <h2 style="margin-top:0;">Hi ${employee.name},</h2>
    <p>Use the verification code below to confirm your email on the Prem Industries Leave Portal.</p>
    <p style="text-align:center;margin:24px 0;">
      <span style="display:inline-block;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:32px;letter-spacing:10px;font-weight:700;color:#4f46e5;background:#eef2ff;padding:14px 22px;border-radius:12px;border:1px solid #e0e7ff;">${code}</span>
    </p>
    <p style="font-size:14px;color:#6b7280;">This code expires in ${expiresInMinutes} minutes. If you did not request it, you can safely ignore this message.</p>
  `);

export const leaveStatusUpdateTemplate = ({ employee, leave }) => {
  const color = leave.status === 'approved' ? '#10b981' : '#ef4444';
  return wrap(`
    <h2 style="margin-top:0;">Hi ${employee.name},</h2>
    <p>Your leave request has been <span style="color:${color};font-weight:600;text-transform:uppercase;">${leave.status}</span>.</p>
    ${detailsTable(leave)}
    ${leave.adminComment ? `<p><b>Reviewer Comment:</b> ${leave.adminComment}</p>` : ''}
  `);
};

export const leaveApprovedHeadNoticeTemplate = ({ head, employee, leave, approvedBy }) =>
  wrap(`
    <h2 style="margin-top:0;">Hi ${head?.name?.split(' ')[0] || 'there'},</h2>
    <p><b>${approvedBy?.name || 'A department head'}</b> approved a leave request from <b>${employee.name}</b> (${employee.employeeId} &middot; ${employee.department}).</p>
    ${detailsTable(leave)}
    ${leave.adminComment ? `<p><b>Approver Comment:</b> ${leave.adminComment}</p>` : ''}
    <p style="font-size:13px;color:#6b7280;">You can overturn this approval from the Leave Portal up until the leave start date.</p>
  `);

export const leaveReversedTemplate = ({ recipientName, employee, leave, reversedBy, wasOriginalApprover }) =>
  wrap(`
    <h2 style="margin-top:0;">Hi ${recipientName?.split(' ')[0] || 'there'},</h2>
    <p>
      ${wasOriginalApprover
        ? `Head <b>${reversedBy?.name || ''}</b> has overturned your earlier approval of <b>${employee.name}</b>'s leave request.`
        : `Your previously approved leave has been overturned by <b>${reversedBy?.name || 'a head'}</b>.`}
    </p>
    ${detailsTable(leave)}
    ${leave.adminComment ? `<p><b>Reason:</b> ${leave.adminComment}</p>` : ''}
    <p style="font-size:13px;color:#6b7280;">The leave status is now <b>REJECTED</b>. Please reach out to the head if you need clarification.</p>
  `);

export const weeklyHeadDigestTemplate = ({ head, weekStart, weekEnd, leaves }) => {
  const rows = leaves.length
    ? leaves.map((leave) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${leave.employee?.name || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${leave.employee?.employeeId || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${leave.employee?.department || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${leaveTypeLabel(leave.leaveType)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${new Date(leave.startDate).toLocaleDateString()}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${new Date(leave.endDate).toLocaleDateString()}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="6" style="padding:14px;text-align:center;color:#6b7280;">No approved leaves for this week.</td></tr>';

  return wrap(`
    <h2 style="margin-top:0;">Hi ${head.name},</h2>
    <p>Approved leave roster for ${weekStart.toLocaleDateString()} to ${weekEnd.toLocaleDateString()}.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
      <thead>
        <tr style="background:#f9fafb;">
          <th align="left" style="padding:8px;border-bottom:1px solid #e5e7eb;">Name</th>
          <th align="left" style="padding:8px;border-bottom:1px solid #e5e7eb;">ID</th>
          <th align="left" style="padding:8px;border-bottom:1px solid #e5e7eb;">Department</th>
          <th align="left" style="padding:8px;border-bottom:1px solid #e5e7eb;">Type</th>
          <th align="left" style="padding:8px;border-bottom:1px solid #e5e7eb;">From</th>
          <th align="left" style="padding:8px;border-bottom:1px solid #e5e7eb;">To</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `);
};
