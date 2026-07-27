/**
 * Application Payment Service
 * Manages payments for new applications and renewals
 */

import { calculateValidUntilDate } from '@/lib/utils/date-utils';

export interface PaymentSession {
  applicationId?: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPhone: string;
  enrollmentId?: string;
  amount: number;
  purpose: 'new_registration' | 'renewal';
  duration: number; // in years
  sessionStartYear: number;
  sessionEndYear: number;
  validUntil: string; // ISO date string
  paymentMode: 'online' | 'offline';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  offlinePaymentId?: string;
  paymentReceipt?: string;
  paidAt?: string;
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Calculate fee based on duration
 * Calculates fee based on duration and provided yearly fee
 * Note: This is a client-side helper. Always verify with server-side calculation.
 * 
 * @param durationInYears - Number of years
 * @param yearlyFee - Fee per year (default 1200)
 * @returns Total fee for the duration
 */
export function calculateFee(durationInYears: number, yearlyFee: number = 0): number {
  return yearlyFee * durationInYears;
}

/**
 * Calculate session dates based on duration
 * 
 * @param startYear - Starting year
 * @param duration - Duration in years
 * @param deadlineConfig - Deadline config { month, day } - REQUIRED
 */
export function calculateSessionDates(
  startYear: number,
  duration: number,
  deadlineConfig: { month: number; day: number }
): {
  sessionStartYear: number;
  sessionEndYear: number;
  validUntil: string;
} {
  const sessionEndYear = startYear + duration;
  // Calculate validUntil using provided config
  const validUntil = calculateValidUntilDate(startYear, duration, deadlineConfig).toISOString();

  return {
    sessionStartYear: startYear,
    sessionEndYear,
    validUntil
  };
}

/**
 * Save payment session to localStorage
 */
export function savePaymentSession(session: PaymentSession): void {
  try {
    const existingSessions = getPaymentSessions();
    const updatedSessions = existingSessions.filter(
      s => s.userId !== session.userId || s.purpose !== session.purpose
    );
    updatedSessions.push(session);

    localStorage.setItem('paymentSessions', JSON.stringify(updatedSessions));

    // Also save as current session for quick access
    localStorage.setItem('currentPaymentSession', JSON.stringify(session));
  } catch (error) {
    console.error('Error saving payment session:', error);
  }
}

/**
 * Get all payment sessions from localStorage
 */
export function getPaymentSessions(): PaymentSession[] {
  try {
    const sessions = localStorage.getItem('paymentSessions');
    return sessions ? JSON.parse(sessions) : [];
  } catch (error) {
    console.error('Error getting payment sessions:', error);
    return [];
  }
}

/**
 * Get current payment session
 */
export function getCurrentPaymentSession(): PaymentSession | null {
  try {
    const session = localStorage.getItem('currentPaymentSession');
    return session ? JSON.parse(session) : null;
  } catch (error) {
    console.error('Error getting current payment session:', error);
    return null;
  }
}

/**
 * Get payment session by user ID and purpose
 */
export function getPaymentSession(
  userId: string,
  purpose: 'new_registration' | 'renewal'
): PaymentSession | null {
  const sessions = getPaymentSessions();
  return sessions.find(s => s.userId === userId && s.purpose === purpose) || null;
}

/**
 * Update payment session status
 */
export function updatePaymentSessionStatus(
  userId: string,
  purpose: 'new_registration' | 'renewal',
  status: PaymentSession['status'],
  additionalData?: Partial<PaymentSession>
): void {
  try {
    const sessions = getPaymentSessions();
    const sessionIndex = sessions.findIndex(
      s => s.userId === userId && s.purpose === purpose
    );

    if (sessionIndex !== -1) {
      sessions[sessionIndex] = {
        ...sessions[sessionIndex],
        status,
        ...additionalData,
        updatedAt: new Date().toISOString()
      };

      localStorage.setItem('paymentSessions', JSON.stringify(sessions));

      // Update current session if it matches
      const currentSession = getCurrentPaymentSession();
      if (currentSession?.userId === userId && currentSession?.purpose === purpose) {
        localStorage.setItem('currentPaymentSession', JSON.stringify(sessions[sessionIndex]));
      }
    }
  } catch (error) {
    console.error('Error updating payment session status:', error);
  }
}

/**
 * Clear payment session
 */
export function clearPaymentSession(userId: string, purpose: 'new_registration' | 'renewal'): void {
  try {
    const sessions = getPaymentSessions();
    const updatedSessions = sessions.filter(
      s => !(s.userId === userId && s.purpose === purpose)
    );
    localStorage.setItem('paymentSessions', JSON.stringify(updatedSessions));

    // Clear current session if it matches
    const currentSession = getCurrentPaymentSession();
    if (currentSession?.userId === userId && currentSession?.purpose === purpose) {
      localStorage.removeItem('currentPaymentSession');
    }
  } catch (error) {
    console.error('Error clearing payment session:', error);
  }
}

/**
 * Check if user has a completed payment for a purpose
 */
export function hasCompletedPayment(
  userId: string,
  purpose: 'new_registration' | 'renewal'
): boolean {
  const session = getPaymentSession(userId, purpose);
  return session?.status === 'completed';
}

/**
 * Store payment receipt in localStorage
 */
export function storePaymentReceipt(
  userId: string,
  purpose: 'new_registration' | 'renewal',
  receipt: {
    orderId: string;
    paymentId: string;
    signature: string;
    amount: number;
    timestamp: string;
  }
): void {
  try {
    const key = `payment_receipt_${userId}_${purpose}`;
    localStorage.setItem(key, JSON.stringify(receipt));
  } catch (error) {
    console.error('Error storing payment receipt:', error);
  }
}

/**
 * Get payment receipt from localStorage
 */
export function getPaymentReceipt(
  userId: string,
  purpose: 'new_registration' | 'renewal'
): any {
  try {
    const key = `payment_receipt_${userId}_${purpose}`;
    const receipt = localStorage.getItem(key);
    return receipt ? JSON.parse(receipt) : null;
  } catch (error) {
    console.error('Error getting payment receipt:', error);
    return null;
  }
}

/**
 * Clear all payment data for a user
 */
export function clearAllPaymentData(userId: string): void {
  try {
    // Clear sessions
    const sessions = getPaymentSessions();
    const updatedSessions = sessions.filter(s => s.userId !== userId);
    localStorage.setItem('paymentSessions', JSON.stringify(updatedSessions));

    // Clear current session if it belongs to the user
    const currentSession = getCurrentPaymentSession();
    if (currentSession?.userId === userId) {
      localStorage.removeItem('currentPaymentSession');
    }

    // Clear receipts
    localStorage.removeItem(`payment_receipt_${userId}_new_registration`);
    localStorage.removeItem(`payment_receipt_${userId}_renewal`);
  } catch (error) {
    console.error('Error clearing payment data:', error);
  }
}

/**
 * Check if payment session is expired (24 hours)
 */
export function isPaymentSessionExpired(session: PaymentSession): boolean {
  const createdAt = new Date(session.createdAt);
  const now = new Date();
  const hoursDiff = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
  return hoursDiff > 24;
}

/**
 * Clean up expired sessions
 */
export function cleanupExpiredSessions(): void {
  try {
    const sessions = getPaymentSessions();
    const validSessions = sessions.filter(s => !isPaymentSessionExpired(s) || s.status === 'completed');
    localStorage.setItem('paymentSessions', JSON.stringify(validSessions));
  } catch (error) {
    console.error('Error cleaning up expired sessions:', error);
  }
}
