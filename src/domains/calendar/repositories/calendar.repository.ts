/**
 * D2 Calendar Repository — Firestore Implementation
 *
 * Persistence owner: Firestore (`settings/deadline` document).
 * Business computation (`deriveAcademicLifecycle`) stays in CalendarService / deadline-computation.
 */

import { adminDb } from '@/lib/firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';
import type { DeadlineConfig } from '@/lib/types/deadline-config';
import { deriveAcademicLifecycle } from '@/lib/utils/deadline-computation';

const SETTINGS_COLLECTION = 'settings';
const DEADLINE_DOC_ID = 'deadline';


const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const getOrdinal = (day: number): string => {
  if (day > 3 && day < 21) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5-minute TTL
let activeConfigCache: { data: DeadlineConfig; expiresAt: number } | null = null;

export function invalidateActiveConfigCache(): void {
  activeConfigCache = null;
}

export function setActiveConfigForTesting(config: DeadlineConfig): void {
  activeConfigCache = { data: config, expiresAt: Date.now() + CACHE_TTL_MS };
}

export async function findActiveConfig(): Promise<DeadlineConfig> {
  if (activeConfigCache && Date.now() < activeConfigCache.expiresAt) {
    return activeConfigCache.data;
  }

  let firestoreData: Record<string, any> = {};

  // 1. Query PostgreSQL system_settings (Authoritative Source of Truth)
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const supabase = getSupabaseServer();
      const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'deadline')
        .maybeSingle();
      if (!error && data?.value && Object.keys(data.value).length > 0) {
        firestoreData = data.value;
      }
    }
  } catch {
    // Fallback to Firestore below
  }

  if (Object.keys(firestoreData).length === 0 && adminDb) {
    try {
      const doc = await adminDb.collection(SETTINGS_COLLECTION).doc(DEADLINE_DOC_ID).get();
      if (doc.exists) {
        firestoreData = (doc.data() as Record<string, any>) || {};
      }
    } catch (err: any) {
      console.warn('⚠️ [calendar] Failed to fetch settings/deadline from Firestore, using default:', err.message);
    }
  }

  const startMonth = typeof firestoreData.academicSessionStart?.month === 'number'
    ? firestoreData.academicSessionStart.month
    : 6; // July default (0-indexed)
  const startDay = firestoreData.academicSessionStart?.day || 1;
  const currentYear = new Date().getFullYear();
  const lifecycle = deriveAcademicLifecycle(startMonth, startDay, currentYear);

  const config: DeadlineConfig = {
    description: firestoreData.description ?? 'Academic Calendar Configuration',
    version: firestoreData.version ?? '1.0.0',
    lastUpdated: firestoreData.lastUpdated ?? new Date().toISOString(),
    lastUpdatedBy: firestoreData.lastUpdatedBy ?? 'system',

    academicSessionStart: {
      month: startMonth,
      day: startDay,
    },

    academicYear: {
      description: 'Academic year boundary',
      anchorMonth: lifecycle.expiry.getUTCMonth(),
      anchorMonthName: MONTH_NAMES[lifecycle.expiry.getUTCMonth()],
      anchorDay: lifecycle.expiry.getUTCDate(),
      anchorDayOrdinal: getOrdinal(lifecycle.expiry.getUTCDate()),
    },

    renewalNotification: {
      description: 'Renewal notification start date',
      month: lifecycle.reminder1.getUTCMonth(),
      monthName: MONTH_NAMES[lifecycle.reminder1.getUTCMonth()],
      day: lifecycle.reminder1.getUTCDate(),
      dayOrdinal: getOrdinal(lifecycle.reminder1.getUTCDate()),
      hour: 0,
      minute: 5,
      daysBeforeDeadline: 90,
      displayText: 'Renewal notification period has started',
    },

    renewalDeadline: {
      description: 'Renewal deadline date',
      month: lifecycle.deadline.getUTCMonth(),
      monthName: MONTH_NAMES[lifecycle.deadline.getUTCMonth()],
      day: lifecycle.deadline.getUTCDate(),
      dayOrdinal: getOrdinal(lifecycle.deadline.getUTCDate()),
      hour: 23,
      minute: 59,
      displayText: 'Renewal deadline date',
    },

    softBlock: {
      description: 'Soft block date (live tracking disabled)',
      month: lifecycle.softBlock.getUTCMonth(),
      monthName: MONTH_NAMES[lifecycle.softBlock.getUTCMonth()],
      day: lifecycle.softBlock.getUTCDate(),
      dayOrdinal: getOrdinal(lifecycle.softBlock.getUTCDate()),
      daysAfterDeadline: 15,
      displayText: 'Soft block active — live tracking blocked',
      warningText: firestoreData.softBlock?.warningText || "Student's access to Live Bus Tracking will be blocked after this date.",
    },

    hardDelete: {
      description: 'Hard delete date (account removal)',
      month: lifecycle.hardDelete.getUTCMonth(),
      monthName: MONTH_NAMES[lifecycle.hardDelete.getUTCMonth()],
      day: lifecycle.hardDelete.getUTCDate(),
      dayOrdinal: getOrdinal(lifecycle.hardDelete.getUTCDate()),
      daysAfterDeadline: 60,
      daysAfterSoftBlock: 45,
      displayText: 'Hard delete scheduled',
      criticalWarningText: firestoreData.hardDelete?.criticalWarningText || 'Warning: Account will be permanently deleted.',
    },

    urgentWarningThreshold: {
      description: 'Days before hard delete for warning',
      days: firestoreData.urgentWarningThreshold?.days ?? 15,
      displayText: 'Critical warning period',
    },

    contactInfo: firestoreData.contactInfo ?? {
      description: 'Contact office info',
      officeName: 'AdtU Transport Office',
      phone: '+91 93657 71454',
      email: 'support@adtu.in',
      officeHours: 'Mon-Fri 9:00 AM - 5:00 PM',
      address: 'Panikhaiti, Guwahati, Assam 781026',
      visitInstructions: 'Please visit during office hours with your valid student ID.',
    },

    timeline: {
      description: 'Academic Session Timeline Events',
      events: [
        {
          id: 'session_start',
          date: { month: startMonth, day: startDay },
          label: 'Academic Session Starts',
          color: 'blue',
          icon: 'calendar',
        },
        {
          id: 'expiry',
          date: { month: lifecycle.expiry.getUTCMonth(), day: lifecycle.expiry.getUTCDate() },
          label: 'Bus Service Expires',
          color: 'amber',
          icon: 'clock',
        },
        {
          id: 'soft_block',
          date: { month: lifecycle.softBlock.getUTCMonth(), day: lifecycle.softBlock.getUTCDate() },
          label: 'Soft Block Applied',
          color: 'orange',
          icon: 'alert-triangle',
        },
        {
          id: 'hard_delete',
          date: { month: lifecycle.hardDelete.getUTCMonth(), day: lifecycle.hardDelete.getUTCDate() },
          label: 'Hard Delete Scheduled',
          color: 'red',
          icon: 'trash-2',
          critical: true,
        },
      ],
    },
  };

  activeConfigCache = { data: config, expiresAt: Date.now() + CACHE_TTL_MS };
  return config;
}

export async function saveConfig(config: DeadlineConfig, updatedByUid?: string): Promise<void> {
  const payload = {
    description: config.description,
    version: config.version,
    lastUpdated: new Date().toISOString(),
    lastUpdatedBy: updatedByUid || 'admin',
    academicSessionStart: {
      month: config.academicSessionStart.month,
      day: config.academicSessionStart.day,
    },
    urgentWarningThreshold: {
      days: config.urgentWarningThreshold.days,
    },
    softBlock: {
      warningText: config.softBlock.warningText,
    },
    hardDelete: {
      criticalWarningText: config.hardDelete.criticalWarningText,
    },
    contactInfo: config.contactInfo,
  };

  // 1. Write to PostgreSQL system_settings
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const supabase = getSupabaseServer();
      await supabase.from('system_settings').upsert({
        key: 'deadline',
        value: payload,
        updated_at: payload.lastUpdated,
        updated_by: updatedByUid || 'admin',
      });
    }
  } catch (err) {
    console.warn('[calendar.repository] Failed to persist deadline to PostgreSQL system_settings:', err);
  }

  // 2. Dual-write to Firestore if adminDb initialized
  if (adminDb) {
    try {
      await adminDb.collection(SETTINGS_COLLECTION).doc(DEADLINE_DOC_ID).set(payload, { merge: true });
    } catch (err: any) {
      console.warn('[calendar.repository] Firestore write failed:', err.message);
    }
  }

  invalidateActiveConfigCache();
}


