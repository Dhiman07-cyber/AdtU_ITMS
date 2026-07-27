/**
 * Admin Email Service
 * 
 * Handles email notifications through the configured email provider.
 * 
 * This service is used for:
 * - Notifying admins when moderators add students
 * - Sending payment receipts
 * - Important system notifications
 */

import { Resend, type Attachment } from 'resend';
import { getUsersByRole } from '@/domains/identity';

// Environment variables
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL;
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || 'noreply@adtu.ac.in';

let resendClient: Resend | null = null;

// Check if email is configured
const isEmailConfigured = (): boolean => {
  return !!(RESEND_API_KEY && EMAIL_FROM);
};

const getResendClient = () => {
  if (!isEmailConfigured()) {
    console.warn('Email provider configuration missing. Email service will use fallback.');
    return null;
  }

  if (!resendClient) {
    resendClient = new Resend(RESEND_API_KEY);
  }

  return resendClient;
};

// Fallback email sending method (logs to console in development)
const sendEmailFallback = async (options: {
  to: string[];
  subject: string;
  html: string;
}) => {
  console.log('[EMAIL SERVICE] Email provider missing. Email would be sent.');
  console.log('   Recipient count:', options.to.length);
  console.log('   Subject:', options.subject);
  console.log('   To enable emails, set RESEND_API_KEY and EMAIL_FROM in the server environment.');
  return { success: true, fallback: true };
};

const sendEmail = async (options: {
  to: string | string[];
  subject: string;
  html: string;
  attachments?: Attachment[];
}): Promise<{ success: boolean; error?: string; messageId?: string }> => {
  const recipients = Array.isArray(options.to) ? options.to : [options.to];
  const client = getResendClient();

  if (!client || !EMAIL_FROM) {
    return sendEmailFallback({
      to: recipients,
      subject: options.subject,
      html: options.html,
    });
  }

  try {
    const { data, error } = await client.emails.send({
      from: EMAIL_FROM,
      to: options.to,
      replyTo: EMAIL_REPLY_TO,
      subject: options.subject,
      html: options.html,
      attachments: options.attachments,
    });

    if (error) {
      return { success: false, error: error.message || 'Email provider rejected the request' };
    }

    return { success: true, messageId: data?.id };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to send email' };
  }
};

export interface StudentAddedEmailData {
  // Student Details
  studentName: string;
  studentEmail: string;
  studentPhone: string;
  enrollmentId: string;
  faculty: string;
  department: string;
  semester: string;
  // Bus & Route Details
  shift: string;
  routeName: string;
  busName: string;
  pickupPoint: string;
  // Session Details
  sessionStartYear: number;
  sessionEndYear: number;
  validUntil: string;
  durationYears: number;
  // Payment Details
  paymentAmount: number;
  transactionId: string;
  // Added By
  addedBy: {
    name: string;
    employeeId: string;
    role: 'moderator' | 'admin';
  };
  // Timestamp
  addedAt: string;
}

export interface AdminEmailRecipient {
  email: string;
  name: string;
}

export interface ApplicationRejectedEmailData {
  studentName: string;
  studentEmail: string;
  reason: string;
  rejectedBy: string;
}

export interface ApplicationApprovedEmailData {
  studentName: string;
  studentEmail: string;
  busNumber: string;
  routeName: string;
  shift: string;
  validUntil: string;
}

/**
 * Get all admin emails from PostgreSQL
 */
export async function getAdminEmailRecipients(): Promise<AdminEmailRecipient[]> {
  try {
    const adminUsers = await getUsersByRole('admin');
    const adminRecipients: AdminEmailRecipient[] = adminUsers
      .filter((u: any) => u.email)
      .map((u: any) => ({
        email: u.email,
        name: u.name || u.fullName || 'Admin'
      }));

    // Fallback to ADMIN_EMAIL from env if no admins found
    if (adminRecipients.length === 0 && ADMIN_EMAIL) {
      adminRecipients.push({
        email: ADMIN_EMAIL,
        name: 'System Admin'
      });
    }

    return adminRecipients;
  } catch (error) {
    console.error('❌ Error fetching admin emails:', error);
    // Return env email as final fallback
    if (ADMIN_EMAIL) {
      return [{ email: ADMIN_EMAIL, name: 'System Admin' }];
    }
    return [];
  }
}

/**
 * Send email notification to admins when a moderator adds a student
 */
export async function sendStudentAddedNotification(
  adminsOrNull: AdminEmailRecipient[] | null,
  studentData: StudentAddedEmailData,
  attachment?: { content: Buffer; filename: string }
): Promise<{ success: boolean; error?: string }> {

  // If no admins provided, fetch them automatically
  let recipients = adminsOrNull;
  if (!recipients || recipients.length === 0) {
    recipients = await getAdminEmailRecipients();
  }

  if (!recipients || recipients.length === 0) {
    console.warn('⚠️ No admin recipients found for student added notification');
    return { success: false, error: 'No admin recipients' };
  }

  const adminEmails = recipients.map(a => a.email);

  // Generate the email HTML
  const emailHtml = generateStudentAddedEmailHtml(studentData);
  const subject = `🎓 New Student Added: ${studentData.studentName} - By ${studentData.addedBy.name}`;

  try {
    const attachments: Attachment[] = attachment
      ? [{
        filename: attachment.filename,
        content: attachment.content,
        contentType: 'application/pdf',
      }]
      : [];

    const result = await sendEmail({
      to: adminEmails,
      subject,
      html: emailHtml,
      attachments,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    console.log('Admin notification email sent:', result.messageId || 'provider accepted');
    return { success: true };
  } catch (error: any) {
    console.error('❌ Error sending email:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
}

/**
 * Generate the HTML email content for student added notification
 * Premium dark theme design with glassmorphism effects
 */
function generateStudentAddedEmailHtml(data: StudentAddedEmailData): string {
  const formatCurrency = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;
  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };
  const formatTime = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return '';
    }
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;color:#f8fafc;">
  <div style="background:#0f172a;padding:40px 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:650px;margin:0 auto;background:#1e293b;border-radius:24px;border:1px solid #334155;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);">
      
      <!-- Premium Header with Gradient -->
      <tr>
        <td style="background:linear-gradient(135deg,#6366f1 0%,#a855f7 50%,#ec4899 100%);padding:35px 30px;text-align:center;">
          <div style="background:rgba(255,255,255,0.15);display:inline-block;padding:12px 28px;border-radius:16px;border:1px solid rgba(255,255,255,0.25);">
            <div style="font-size:22px;font-weight:bold;color:#fff;letter-spacing:1px;">🎓 NEW STUDENT ADDED</div>
            <div style="color:rgba(255,255,255,0.85);font-size:12px;margin-top:6px;text-transform:uppercase;letter-spacing:2px;">AdtU Bus Services</div>
          </div>
          <div style="margin-top:18px;">
            <span style="background:#22c55e;color:#fff;padding:6px 18px;border-radius:20px;font-size:11px;font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,0.25);">
              ✓ REGISTRATION COMPLETE
            </span>
          </div>
        </td>
      </tr>

      <!-- Student Name Hero Card -->
      <tr>
        <td style="padding:30px 30px 0;text-align:center;">
          <div style="background:#0f172a;border-radius:16px;padding:25px;border:1px solid #334155;">
            <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">Student Name</div>
            <div style="font-size:26px;font-weight:700;color:#fff;">${data.studentName}</div>
            <div style="font-size:13px;color:#818cf8;margin-top:6px;font-family:monospace;">${data.enrollmentId || 'Pending Enrollment'}</div>
          </div>
        </td>
      </tr>

      <!-- Student Details Section -->
      <tr>
        <td style="padding:20px 30px;">
          <div style="background:#0f172a;border-radius:16px;padding:20px;border:1px solid #334155;">
            <div style="font-size:12px;color:#a855f7;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:15px;border-bottom:1px solid #334155;padding-bottom:10px;">👤 Student Details</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
              <tr>
                <td style="padding:8px 0;color:#94a3b8;">Email</td>
                <td style="padding:8px 0;text-align:right;color:#4ade80;">${data.studentEmail}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#94a3b8;border-top:1px solid #334155;">Phone</td>
                <td style="padding:8px 0;text-align:right;color:#fff;border-top:1px solid #334155;">${data.studentPhone || 'Not Provided'}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#94a3b8;border-top:1px solid #334155;">Faculty</td>
                <td style="padding:8px 0;text-align:right;color:#fff;border-top:1px solid #334155;">${data.faculty || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#94a3b8;border-top:1px solid #334155;">Department</td>
                <td style="padding:8px 0;text-align:right;color:#fff;border-top:1px solid #334155;">${data.department || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#94a3b8;border-top:1px solid #334155;">Semester</td>
                <td style="padding:8px 0;text-align:right;color:#fff;border-top:1px solid #334155;">${data.semester || 'N/A'}</td>
              </tr>
            </table>
          </div>
        </td>
      </tr>

      <!-- Bus & Route Section -->
      <tr>
        <td style="padding:0 30px 20px;">
          <div style="background:#0f172a;border-radius:16px;padding:20px;border:1px solid #334155;">
            <div style="font-size:12px;color:#06b6d4;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:15px;border-bottom:1px solid #334155;padding-bottom:10px;">🚌 Bus & Route Details</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
              <tr>
                <td style="padding:8px 0;color:#94a3b8;">Shift</td>
                <td style="padding:8px 0;text-align:right;color:#fbbf24;font-weight:600;">${data.shift}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#94a3b8;border-top:1px solid #334155;">Route</td>
                <td style="padding:8px 0;text-align:right;color:#fff;border-top:1px solid #334155;">${data.routeName}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#94a3b8;border-top:1px solid #334155;">Bus</td>
                <td style="padding:8px 0;text-align:right;color:#fff;border-top:1px solid #334155;">${data.busName}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#94a3b8;border-top:1px solid #334155;">Pickup Point</td>
                <td style="padding:8px 0;text-align:right;color:#fff;border-top:1px solid #334155;">${data.pickupPoint}</td>
              </tr>
            </table>
          </div>
        </td>
      </tr>

      <!-- Session & Payment KPIs -->
      <tr>
        <td style="padding:0 30px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="33%" style="padding:5px;">
                <div style="background:#0f172a;border-radius:12px;padding:18px 12px;text-align:center;border:1px solid #334155;">
                  <div style="font-size:22px;font-weight:700;color:#818cf8;">${data.durationYears}</div>
                  <div style="font-size:10px;color:#64748b;text-transform:uppercase;margin-top:4px;">YEAR${data.durationYears > 1 ? 'S' : ''}</div>
                </div>
              </td>
              <td width="34%" style="padding:5px;">
                <div style="background:#0f172a;border-radius:12px;padding:18px 12px;text-align:center;border:1px solid #334155;">
                  <div style="font-size:22px;font-weight:700;color:#4ade80;">${formatCurrency(data.paymentAmount)}</div>
                  <div style="font-size:10px;color:#64748b;text-transform:uppercase;margin-top:4px;">AMOUNT</div>
                </div>
              </td>
              <td width="33%" style="padding:5px;">
                <div style="background:#0f172a;border-radius:12px;padding:18px 12px;text-align:center;border:1px solid #334155;">
                  <div style="font-size:18px;font-weight:700;color:#f472b6;">${data.sessionStartYear}-${String(data.sessionEndYear).slice(-2)}</div>
                  <div style="font-size:10px;color:#64748b;text-transform:uppercase;margin-top:4px;">SESSION</div>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Transaction Details -->
      <tr>
        <td style="padding:0 30px 20px;">
          <div style="background:linear-gradient(135deg,#059669 0%,#10b981 100%);border-radius:16px;padding:20px;box-shadow:0 10px 25px -5px rgba(16,185,129,0.3);">
            <div style="font-size:11px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:1px;">Payment Transaction</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.6);font-family:monospace;margin-top:6px;word-break:break-all;">${data.transactionId}</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;font-size:12px;">
              <tr>
                <td style="color:rgba(255,255,255,0.8);">Method</td>
                <td style="text-align:right;color:#fff;font-weight:600;">Offline (Verified)</td>
              </tr>
              <tr>
                <td style="color:rgba(255,255,255,0.8);padding-top:6px;">Status</td>
                <td style="text-align:right;padding-top:6px;">
                  <span style="background:#fff;color:#059669;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:700;">✓ APPROVED</span>
                </td>
              </tr>
              <tr>
                <td style="color:rgba(255,255,255,0.8);padding-top:6px;">Valid Until</td>
                <td style="text-align:right;color:#fff;font-weight:600;padding-top:6px;">${formatDate(data.validUntil)}</td>
              </tr>
            </table>
          </div>
        </td>
      </tr>

      <!-- Added By Section -->
      <tr>
        <td style="padding:0 30px 25px;">
          <div style="background:linear-gradient(135deg,#7c3aed 0%,#a855f7 100%);border-radius:16px;padding:18px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="font-size:10px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:1px;">Added & Approved By</div>
                  <div style="font-size:16px;font-weight:700;color:#fff;margin-top:4px;">${data.addedBy.name}</div>
                  <div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px;">${data.addedBy.employeeId || 'Staff'}</div>
                </td>
                <td style="text-align:right;vertical-align:middle;">
                  <span style="background:rgba(255,255,255,0.2);color:#fff;padding:6px 14px;border-radius:20px;font-size:10px;font-weight:700;text-transform:uppercase;">
                    ${data.addedBy.role === 'moderator' ? '🛡️ MODERATOR' : '👑 ADMIN'}
                  </span>
                </td>
              </tr>
            </table>
          </div>
        </td>
      </tr>

      <!-- Timestamp -->
      <tr>
        <td style="padding:0 30px 20px;text-align:center;">
          <div style="font-size:11px;color:#64748b;">
            Added on <span style="color:#94a3b8;font-weight:600;">${formatDate(data.addedAt)}</span> at <span style="color:#94a3b8;font-weight:600;">${formatTime(data.addedAt)}</span>
          </div>
        </td>
      </tr>

      <!-- PDF Attachment Notice -->
      <tr>
        <td style="padding:0 30px 25px;">
          <div style="background:#0f172a;border-radius:12px;padding:15px 20px;border:1px solid #334155;text-align:center;">
            <span style="font-size:20px;">📄</span>
            <span style="color:#94a3b8;font-size:12px;margin-left:10px;">E-Receipt PDF attached with this email</span>
          </div>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#020617;padding:25px 30px;text-align:center;border-top:1px solid #334155;">
          <div style="color:#64748b;font-size:11px;">This is an automated notification from</div>
          <div style="color:#818cf8;font-size:13px;font-weight:600;margin-top:4px;">AdtU Integrated Transport Management System</div>
          <div style="color:#475569;font-size:10px;margin-top:10px;">Assam down town University, Guwahati • © ${new Date().getFullYear()}</div>
        </td>
      </tr>

    </table>
  </div>
</body>
</html>
  `;
}

/**
 * Send email notification to student when their application is rejected
 */
export async function sendApplicationRejectedNotification(
  data: ApplicationRejectedEmailData
): Promise<{ success: boolean; error?: string }> {

  if (!data.studentEmail) {
    console.warn('⚠️ No student email provided for rejection notification');
    return { success: false, error: 'No student email' };
  }

  // Generate the email HTML
  const emailHtml = generateApplicationRejectedEmailHtml(data);
  const subject = `⚠️ Application Status Update: Bus Service Request`;

  try {
    const result = await sendEmail({
      to: data.studentEmail,
      subject,
      html: emailHtml,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    console.log('Application rejection email sent:', result.messageId || 'provider accepted');
    return { success: true };
  } catch (error: any) {
    console.error('❌ Error sending rejection email:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
}

/**
 * Send email notification to student when their application is approved
 */
export async function sendApplicationApprovedNotification(
  data: ApplicationApprovedEmailData
): Promise<{ success: boolean; error?: string }> {

  if (!data.studentEmail) {
    console.warn('⚠️ No student email provided for approval notification');
    return { success: false, error: 'No student email' };
  }

  // Generate the email HTML
  const emailHtml = generateApplicationApprovedEmailHtml(data);
  const subject = `🎉 Application Approved: AdtU Bus Service`;

  try {
    const result = await sendEmail({
      to: data.studentEmail,
      subject,
      html: emailHtml,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    console.log('Application approval email sent:', result.messageId || 'provider accepted');
    return { success: true };
  } catch (error: any) {
    console.error('❌ Error sending approval email:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
}

/**
 * Generate the HTML email content for application rejection
 * Professional and clear design notifying the student of the rejection and reason
 */
function generateApplicationRejectedEmailHtml(data: ApplicationRejectedEmailData): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;color:#1e293b;">
  <div style="background:#f1f5f9;padding:40px 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);border:1px solid #e2e8f0;">
      
      <!-- Header -->
      <tr>
        <td style="background:linear-gradient(135deg,#ef4444 0%,#dc2626 100%);padding:30px 20px;text-align:center;">
          <div style="font-size:24px;font-weight:bold;color:#ffffff;letter-spacing:1px;text-transform:uppercase;">Application Status Update</div>
          <div style="color:rgba(255,255,255,0.9);font-size:12px;margin-top:4px;letter-spacing:2px;">ADTU BUS SERVICES</div>
        </td>
      </tr>

      <!-- Content -->
      <tr>
        <td style="padding:40px 30px;">
          <div style="font-size:18px;font-weight:600;margin-bottom:20px;">Dear ${data.studentName},</div>
          
          <p style="font-size:15px;line-height:1.6;color:#475569;margin-bottom:25px;">
            Thank you for your application for the AdtU Bus Service. We have reviewed your request, and unfortunately, we are unable to approve it at this time.
          </p>

          <div style="background:#fff1f2;border-left:4px solid #ef4444;padding:20px;margin-bottom:25px;border-radius:4px;">
            <div style="font-size:12px;color:#991b1b;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Reason for Rejection</div>
            <div style="font-size:16px;color:#7f1d1d;font-style:italic;line-height:1.5;">"${data.reason}"</div>
          </div>

          <p style="font-size:15px;line-height:1.6;color:#475569;margin-bottom:30px;">
            If you believe this is an error or if you have rectified the issue mentioned above, you are welcome to submit a new application through the portal.
          </p>

          <div style="text-align:center;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://adtu-bus-services.vercel.app'}/apply" style="background:#dc2626;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;display:inline-block;box-shadow:0 4px 6px rgba(220,38,38,0.2);">RE-APPLY NOW</a>
          </div>
          
          <div style="margin-top:40px;padding-top:25px;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b;">
            Best regards,<br>
            <strong>Transport Management Team</strong><br>
            Assam down town University
          </div>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#f8fafc;padding:20px 30px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;">
          This is an automated notification. Please do not reply directly to this email.<br>
          © ${new Date().getFullYear()} AdtU Integrated Transport Management System
        </td>
      </tr>

    </table>
  </div>
</body>
</html>
  `;
}

/**
 * Generate the HTML email content for application approval
 */
function generateApplicationApprovedEmailHtml(data: ApplicationApprovedEmailData): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;color:#1e293b;">
  <div style="background:#f0fdf4;padding:40px 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 10px 15px -3px rgba(0,0,0,0.1);border:1px solid #dcfce7;">
      
      <!-- Header -->
      <tr>
        <td style="background:linear-gradient(135deg,#10b981 0%,#059669 100%);padding:40px 20px;text-align:center;">
          <div style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:1px;text-transform:uppercase;">Application Approved!</div>
          <div style="color:rgba(255,255,255,0.9);font-size:12px;margin-top:6px;letter-spacing:2px;font-weight:600;">ADTU BUS SERVICES</div>
        </td>
      </tr>

      <!-- Content -->
      <tr>
        <td style="padding:40px 30px;">
          <div style="font-size:20px;font-weight:700;margin-bottom:20px;">Welcome aboard, ${data.studentName}!</div>
          
          <p style="font-size:16px;line-height:1.6;color:#475569;margin-bottom:30px;">
            We are pleased to inform you that your application for the campus bus service has been <strong>approved</strong>. Your digital bus pass is now active and ready to use.
          </p>

          <div style="background:#f8fafc;border-radius:16px;padding:25px;border:1px solid #e2e8f0;margin-bottom:30px;">
            <div style="font-size:12px;color:#059669;font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:15px;border-bottom:1px solid #e2e8f0;padding-bottom:10px;">🚌 Your Service Details</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
              <tr>
                <td style="padding:10px 0;color:#64748b;">Assigned Bus</td>
                <td style="padding:10px 0;text-align:right;font-weight:700;color:#1e293b;">${data.busNumber}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;color:#64748b;border-top:1px solid #f1f5f9;">Route Name</td>
                <td style="padding:10px 0;text-align:right;font-weight:700;color:#1e293b;border-top:1px solid #f1f5f9;">${data.routeName}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;color:#64748b;border-top:1px solid #f1f5f9;">Operating Shift</td>
                <td style="padding:10px 0;text-align:right;font-weight:700;color:#10b981;border-top:1px solid #f1f5f9;text-transform:capitalize;">${data.shift}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;color:#64748b;border-top:1px solid #f1f5f9;">Valid Until</td>
                <td style="padding:10px 0;text-align:right;font-weight:700;color:#1e293b;border-top:1px solid #f1f5f9;">${data.validUntil}</td>
              </tr>
            </table>
          </div>

          <div style="text-align:center;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://adtu-bus-services.vercel.app'}/student" style="background:#10b981;color:#ffffff;padding:16px 32px;text-decoration:none;border-radius:12px;font-weight:700;font-size:15px;display:inline-block;box-shadow:0 4px 10px rgba(16,185,129,0.3);">VIEW DIGITAL BUS PASS</a>
          </div>
          
          <div style="margin-top:40px;padding-top:25px;border-top:1px solid #f1f5f9;font-size:13px;color:#64748b;">
            Best regards,<br>
            <strong>Transport Management Team</strong><br>
            Assam down town University
          </div>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#f8fafc;padding:25px 30px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;">
          This is an automated notification. Please do not reply directly to this email.<br>
          © ${new Date().getFullYear()} AdtU Integrated Transport Management System
        </td>
      </tr>

    </table>
  </div>
</body>
</html>
  `;
}

export default {
  sendStudentAddedNotification,
  sendApplicationRejectedNotification,
  sendApplicationApprovedNotification,
  getAdminEmailRecipients,
};
