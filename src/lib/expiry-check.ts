import { pgInsertNotification } from '@/domains/notification/repositories/notification.repository.pg';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { deriveAcademicLifecycle } from './utils/deadline-computation';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getStudentById, updateStudent, getUsersByRole } from '@/domains/identity';

interface ExpiryCheckResult {
  totalChecked: number;
  remindersSent: number;
  errors: string[];
  skipped?: boolean;
}

export async function checkAndNotifyExpiringStudents(force: boolean = false): Promise<ExpiryCheckResult> {
  const result: ExpiryCheckResult = {
    totalChecked: 0,
    remindersSent: 0,
    errors: []
  };

  try {
    const deadlineConfig = await getDeadlineConfig();
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth(); // 0-indexed
    const currentDay = now.getUTCDate();

    const startMonth = deadlineConfig.academicSessionStart?.month ?? 6; // default July
    const startDay = deadlineConfig.academicSessionStart?.day ?? 1;

    // Derive dates for the current year
    const lifecycle = deriveAcademicLifecycle(startMonth, startDay, currentYear);

    const isR1 = currentMonth === lifecycle.reminder1.getUTCMonth() && currentDay === lifecycle.reminder1.getUTCDate();
    const isR2 = currentMonth === lifecycle.reminder2.getUTCMonth() && currentDay === lifecycle.reminder2.getUTCDate();
    const isFinal = currentMonth === lifecycle.finalReminder.getUTCMonth() && currentDay === lifecycle.finalReminder.getUTCDate();

    let runR1 = force || isR1;
    let runR2 = isR2;
    let runFinal = isFinal;

    if (!force && !isR1 && !isR2 && !isFinal) {
      console.log(`⏭️ Expiry check skipped. Today: ${now.toDateString()}`);
      result.skipped = true;
      return result;
    }

    const deadlineFirst = new Date(lifecycle.expiry);
    deadlineFirst.setHours(0, 0, 0, 0);
    const deadlineNext = new Date(deadlineFirst);
    deadlineNext.setDate(deadlineNext.getDate() + 1);

    console.log(`🔍 Checking for students expiring on: ${deadlineFirst.toDateString()}`);

    // Query active students expiring in target date range from PostgreSQL
    const supabase = getSupabaseServer();
    const { data: students, error: pgErr } = await supabase
      .from('student_profiles')
      .select('*')
      .eq('status', 'active')
      .gte('valid_until', deadlineFirst.toISOString())
      .lt('valid_until', deadlineNext.toISOString());

    if (pgErr) {
      throw new Error(`Failed to query expiring students: ${pgErr.message}`);
    }

    const mappedStudents = (students || []).map(row => ({
      uid: row.uid,
      status: row.status,
      validUntil: row.valid_until,
      sessionStartYear: row.session_start_year,
      sessionEndYear: row.session_end_year,
      expiryReminderCount: row.expiry_reminder_count || 0,
    }));

    result.totalChecked = mappedStudents.length;
    console.log(`📊 Found ${result.totalChecked} students expiring on ${deadlineFirst.toDateString()}`);

    for (const studentData of mappedStudents) {
      const studentUid = studentData.uid;
      try {
        const currentCount = studentData.expiryReminderCount || 0;

        let shouldSend = false;
        let title = "Bus Service Renewal Reminder";
        let body = "";

        if (runR1 && currentCount === 0) {
          shouldSend = true;
          body = `Your bus service (session ${studentData.sessionStartYear}-${studentData.sessionEndYear}) will expire on ${new Date(studentData.validUntil).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}. Please renew by visiting the Bus Office or apply online to continue your service.`;
        } else if (runR2 && currentCount === 1) {
          shouldSend = true;
          body = `This is your second reminder that your bus service (session ${studentData.sessionStartYear}-${studentData.sessionEndYear}) will expire on ${new Date(studentData.validUntil).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}. Please apply online to renew.`;
        } else if (runFinal && currentCount === 2) {
          shouldSend = true;
          title = "Final Reminder: Bus Service Expiring Soon";
          body = `This is a final reminder that your bus service expires on ${new Date(studentData.validUntil).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}. Only 15 days left! Renew now to avoid service interruption.`;
        }

        if (!shouldSend) continue;

        const nowIso = new Date().toISOString();

        // 1. Write notification to PostgreSQL
        await pgInsertNotification({
          title,
          content: body,
          type: 'info',
          sender: {
            userId: 'system',
            userName: 'System',
            userRole: 'admin'
          },
          target: {
            type: 'specific_users',
            specificUserIds: [studentUid]
          },
          recipientIds: [studentUid],
          readByUserIds: [],
          metadata: {
            sessionStartYear: studentData.sessionStartYear,
            sessionEndYear: studentData.sessionEndYear,
            validUntil: studentData.validUntil,
            profile: '/student/profile',
            renewPage: '/apply'
          }
        });

        // 2. Fetch fresh student details to count reminders and update in PostgreSQL (non-transactional, low-risk)
        const freshStudent = await getStudentById(studentUid);
        const freshCount = freshStudent?.expiryReminderCount || 0;

        await updateStudent(studentUid, {
          lastExpiryReminderSentAt: nowIso,
          expiryReminderCount: freshCount + 1
        });

        result.remindersSent++;
        console.log(`%c✅ Sent reminder to ${studentUid} (count: ${freshCount + 1})`, 'color: green');
      } catch (error: any) {
        result.errors.push(`Failed to process student ${studentUid}: ${error.message}`);
      }
    }

    if (result.remindersSent > 0) {
      await sendAdminSummary(result, "Expiry Reminders Sent", deadlineFirst);
    }

    return result;
  } catch (error: any) {
    console.error('❌ Fatal error in expiry check:', error);
    result.errors.push(`Fatal error: ${error.message}`);
    return result;
  }
}

/**
 * Send a second reminder mid-month (e.g., 15th)
 */
export async function sendMidJuneReminder(force: boolean = false): Promise<ExpiryCheckResult> {
  // Delegate to main check, which now dynamically checks April 1st, May 1st, and June 15th
  return checkAndNotifyExpiringStudents(force);
}

async function sendAdminSummary(result: ExpiryCheckResult, title: string, expiryDate: Date) {
  const admins = await getUsersByRole('admin');
  const adminIds = admins.map(a => a.uid).filter(Boolean);
  if (adminIds.length === 0) return;

  await pgInsertNotification({
    title,
    content: `${result.remindersSent} students were notified about their expiring bus service (${expiryDate.toLocaleDateString()}). Please ensure the Bus Office is prepared for renewals.`,
    type: 'info',
    sender: {
      userId: 'system',
      userName: 'System',
      userRole: 'admin'
    },
    target: {
      type: 'specific_users',
      specificUserIds: adminIds
    },
    recipientIds: adminIds,
    readByUserIds: [],
    metadata: {
      totalChecked: result.totalChecked,
      remindersSent: result.remindersSent,
      errors: result.errors.length
    }
  });
}

/**
 * Function to manually trigger expiry check
 */
export async function manualExpiryCheck(targetMonth?: number, targetYear?: number): Promise<ExpiryCheckResult> {
  console.log('🔧 Manual expiry check triggered');
  // For manual run, we force execution regardless of date
  return checkAndNotifyExpiringStudents(true);
}
