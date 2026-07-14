/**
 * Notification Templates
 * 
 * Pre-filled draft templates for different notification types.
 * These are editable in the UI before sending.
 * Drafts are NOT persisted - only final sent notifications are saved.
 */

export type NotificationType = 'notice' | 'pickup' | 'dropoff' | 'trip' | 'announcement';
export type AudienceScope = 'all' | 'shift' | 'route';
export type ShiftType = 'Morning' | 'Evening' | null;

export interface NotificationTemplate {
  type: NotificationType;
  title: string;
  message: string;
}

export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  // 📝 NOTICE TEMPLATES
  notice: {
    type: 'notice',
    title: '📝 Important Notice for All Students',
    message: `Dear Students, 
    
This is to inform you that {insert notice details here}. Please take note and plan accordingly. For any queries, contact the administration office. 
Thank you for your cooperation.`
  },

  notice_holiday: {
    type: 'notice',
    title: '📅 College Schedule Update – {Date / Event}',
    message: `Dear Students,

Please be informed that on {date}, the college will be {closed/operating on revised timings}. Bus services will be adjusted accordingly. Stay updated through the app for further announcements.
For any queries, contact the administration office.`
  },

  notice_fees: {
    type: 'notice',
    title: '💰 Bus Fees Payment Reminder',
    message: `Dear Students,

This is a reminder to pay your bus fees by {deadline date}. 

Payment Details:
• Amount: ₹{amount}
• Deadline: {date}

'FINAL REMINDER: This is the last date for payment. Students who fail to pay by the deadline will have their bus service temporarily suspended until payment is received.' : 'Late payment may result in service suspension.'

If you have already paid, please ignore this message.
For any queries, contact the administration office.`
  },

  // 🚌 PICKUP TEMPLATES
  pickup_delay: {
    type: 'pickup',
    title: '⏰ Pickup Delay Notification for {Shift / Route}',
    message: `Dear Students,

Please be informed that your bus may arrive approximately {X} minutes late today due to {reason}. We appreciate your patience and understanding.
For any queries, contact the administration office.`
  },

  pickup_change: {
    type: 'pickup',
    title: '🔄 Temporary Bus Change for Pickup',
    message: `Dear Students,

Today, Bus {NewBusNumber} will pick you up instead of Bus {OldBusNumber} for Route {RouteNumber}. No changes in pickup time or stops. Please board the assigned bus accordingly.
For any queries, contact the administration office.`
  },

  pickup_early: {
    type: 'pickup',
    title: '⚡ Early Pickup Alert',
    message: `Dear Students,

Due to {reason}, today's pickup will occur {X} minutes earlier than usual. Kindly be present at your stop on time to avoid missing the bus.
For any queries, contact the administration office.`
  },

  pickup_cancelled: {
    type: 'pickup',
    title: '🚫 Pickup Service Cancelled',
    message: `Dear Students,

Due to {reason}, pickup service for {shift/route} is cancelled today.

Please make alternative arrangements. We apologize for the inconvenience.
For any queries, contact the administration office.`
  },

  // 🏁 DROPOFF TEMPLATES
  dropoff_arrangement: {
    type: 'dropoff',
    title: '📋 Dropoff Arrangement',
    message: `Dear Students,

Below are the bus assignments for today's dropoff schedule. Please check which bus will be serving your route and board accordingly.

{auto-generated matrix summary inserted here}

For any queries, contact the administration office.`
  },

  dropoff_change: {
    type: 'dropoff',
    title: '🔄 Dropoff Bus Change',
    message: `Dear Students,

Please note: Bus {NewBusNumber} will drop you off instead of Bus {OldBusNumber} for Route {RouteNumber} today.

Dropoff time remains the same.
For any queries, contact the administration office.`
  },

  dropoff_delay: {
    type: 'dropoff',
    title: '⏰ Dropoff Delay Notice',
    message: `Dear Students,

Dropoff service may be delayed by approximately {X} minutes today due to {reason}.

We appreciate your patience.
For any queries, contact the administration office.`
  }
};

/**
 * Get template with author info pre-filled
 */
export function getTemplate(
  type: NotificationType,
  teamName: string,
  employeeId: string
): NotificationTemplate {
  // First try to find a template by type
  const template = NOTIFICATION_TEMPLATES[type];
  if (!template) {
    return {
      type: 'notice',
      title: 'Notification',
      message: ''
    };
  }

  // Replace author placeholders with team name
  const message = template.message
    .replace('[Author Name (EMPID)]', `${teamName} (${employeeId})`);

  return {
    ...template,
    message
  };
}

/**
 * Get template by key with author info pre-filled
 */
export function getTemplateByKey(
  templateKey: string,
  teamName: string,
  employeeId: string
): NotificationTemplate {
  const template = NOTIFICATION_TEMPLATES[templateKey];
  if (!template) {
    return {
      type: 'notice',
      title: 'Notification',
      message: ''
    };
  }

  // Replace author placeholders with team name
  const message = template.message
    .replace('[Author Name (EMPID)]', `${teamName} (${employeeId})`);

  return {
    ...template,
    message
  };
}

/**
 * Get signature based on user role
 */
export function getSignature(role: string, employeeId: string, teamName?: string): string {
  if (role === 'driver') {
    return `Regards,\nTransportation team (${employeeId})`;
  } else {
    // For moderator and admin
    const team = teamName || 'Managing team';
    return `Regards,\n${team} (${employeeId})`;
  }
}

/**
 * Build dropoff summary from matrix assignments
 */
export interface DropoffAssignment {
  busId: string;
  busNumber: string;
  plateNumber?: string;
  routeId: string;
  routeName: string;
  stops: Array<{ name: string; stopId?: string }>;
}

export function buildDropoffSummary(assignments: DropoffAssignment[]): string {
  if (assignments.length === 0) {
    return '[No assignments configured]';
  }

  // Build formatted matrix (all buses showing assigned routes)
  const lines: string[] = [];

  // Sort assignments by bus number
  const sortedAssignments = [...assignments].sort((a, b) => {
    const numA = parseInt(a.busNumber.replace('Bus-', ''));
    const numB = parseInt(b.busNumber.replace('Bus-', ''));
    return numA - numB;
  });

  sortedAssignments.forEach(assignment => {
    const stopNames = assignment.stops.map(s => s.name).join(', ');
    lines.push(`${assignment.busNumber} : ${assignment.routeName} (${stopNames})`);
  });

  return lines.join('\n');
}

/**
 * Insert dropoff summary into template message with dynamic shift
 */
export function insertDropoffSummary(
  templateMessage: string,
  assignments: DropoffAssignment[],
  shift?: string
): string {
  const summary = buildDropoffSummary(assignments);

  // Replace shift placeholder if present
  let finalMessage = templateMessage;
  if (shift) {
    const shiftText = shift.charAt(0).toUpperCase() + shift.slice(1);
    finalMessage = finalMessage.replace('{Morning/Evening}', shiftText);
  }

  return finalMessage.replace(
    '{auto-generated matrix summary inserted here}',
    summary
  );
}

