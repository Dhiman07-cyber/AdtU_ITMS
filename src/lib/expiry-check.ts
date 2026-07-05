import { adminDb } from './firebase-admin';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { deriveAcademicLifecycle } from './utils/deadline-computation';

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

    const studentsQuery = await adminDb.collection('students')
      .where('status', '==', 'active')
      .where('validUntil', '>=', deadlineFirst.toISOString())
      .where('validUntil', '<', deadlineNext.toISOString())
      .get();

    result.totalChecked = studentsQuery.size;
    console.log(`📊 Found ${result.totalChecked} students expiring on ${deadlineFirst.toDateString()}`);

    for (const studentDoc of studentsQuery.docs) {
      try {
        const studentData = studentDoc.data();
        const studentUid = studentDoc.id;
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

        const notifRef = adminDb.collection('notifications').doc();
        const nowIso = new Date().toISOString();

        await adminDb.runTransaction(async (transaction) => {
          const studentSnap = await transaction.get(studentDoc.ref);
          const freshData = studentSnap.data();
          const freshCount = freshData?.expiryReminderCount || 0;

          transaction.set(notifRef, {
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
            autoInjectedRecipientIds: [],
            readByUserIds: [],
            isEdited: false,
            isDeletedGlobally: false,
            hiddenForUserIds: [],
            createdAt: nowIso,
            metadata: {
              sessionStartYear: studentData.sessionStartYear,
              sessionEndYear: studentData.sessionEndYear,
              validUntil: studentData.validUntil,
              profile: '/student/profile',
              renewPage: '/apply'
            }
          });

          transaction.update(studentDoc.ref, {
            lastExpiryReminderSentAt: nowIso,
            expiryReminderCount: freshCount + 1
          });
        });

        result.remindersSent++;
        console.log(`✅ Sent reminder to ${studentDoc.id} (count: ${currentCount + 1})`);
      } catch (error: any) {
        result.errors.push(`Failed to process student ${studentDoc.id}: ${error.message}`);
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
  const currentYear = new Date().getFullYear();
  const adminsQuery = await adminDb.collection('admins').get();

  const batch = adminDb.batch();

  for (const adminDoc of adminsQuery.docs) {
    const notifRef = adminDb.collection('notifications').doc();
    batch.set(notifRef, {
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
        specificUserIds: [adminDoc.id]
      },
      recipientIds: [adminDoc.id],
      autoInjectedRecipientIds: [],
      readByUserIds: [],
      isEdited: false,
      isDeletedGlobally: false,
      hiddenForUserIds: [],
      createdAt: new Date().toISOString(),
      metadata: {
        totalChecked: result.totalChecked,
        remindersSent: result.remindersSent,
        errors: result.errors.length
      }
    });
  }

  await batch.commit();
}

/**
 * Function to manually trigger expiry check
 */
export async function manualExpiryCheck(targetMonth?: number, targetYear?: number): Promise<ExpiryCheckResult> {
  console.log('🔧 Manual expiry check triggered');
  // For manual run, we force execution regardless of date
  return checkAndNotifyExpiringStudents(true);
}
