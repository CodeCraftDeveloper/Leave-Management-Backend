const leaveTypeLabels = {
  leave: 'Leave',
  casual: 'Casual',
  sick: 'Sick',
  emergency: 'Emergency',
  paid: 'Paid',
  unpaid: 'Unpaid',
};

export const leaveTypeLabel = (type) => leaveTypeLabels[type] || 'Leave';

