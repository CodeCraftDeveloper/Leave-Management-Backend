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
    <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><b>Leave Type</b></td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-transform:capitalize;">${leave.leaveType}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><b>Start Date</b></td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${new Date(leave.startDate).toLocaleDateString()}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><b>End Date</b></td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${new Date(leave.endDate).toLocaleDateString()}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><b>Total Days</b></td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${leave.totalDays}</td></tr>
    <tr><td style="padding:8px;"><b>Reason</b></td><td style="padding:8px;">${leave.reason}</td></tr>
  </table>
`;

export const leaveAppliedEmployeeTemplate = ({ employee, leave }) =>
  wrap(`
    <h2 style="margin-top:0;">Hi ${employee.name},</h2>
    <p>Your leave application has been submitted successfully and is pending admin review.</p>
    ${detailsTable(leave)}
    <p>You will be notified once it is approved or rejected.</p>
  `);

export const leaveAppliedAdminTemplate = ({ employee, leave }) =>
  wrap(`
    <h2 style="margin-top:0;">New Leave Request</h2>
    <p><b>${employee.name}</b> (${employee.employeeId} &middot; ${employee.department}) submitted a leave request.</p>
    ${detailsTable(leave)}
    <p>Please log in to the admin dashboard to take action.</p>
  `);

export const leaveStatusUpdateTemplate = ({ employee, leave }) => {
  const color = leave.status === 'approved' ? '#10b981' : '#ef4444';
  return wrap(`
    <h2 style="margin-top:0;">Hi ${employee.name},</h2>
    <p>Your leave request has been <span style="color:${color};font-weight:600;text-transform:uppercase;">${leave.status}</span>.</p>
    ${detailsTable(leave)}
    ${leave.adminComment ? `<p><b>Admin Comment:</b> ${leave.adminComment}</p>` : ''}
  `);
};
