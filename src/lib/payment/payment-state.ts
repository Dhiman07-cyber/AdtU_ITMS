/**
 * Canonical frontend payment state model
 *
 * Five user-facing states. Raw Razorpay codes are stored internally for logs
 * but NEVER exposed to students.
 */

// ─── Five canonical frontend states ──────────────────────────────────────────

/**
 * UI-ONLY display state. Lives exclusively in React component state and the
 * recovery hook. Must NEVER be written to:
 *  - Supabase payments table
 *  - Firestore documents
 *  - localStorage PaymentSession.status
 *  - Any database or audit log
 *
 * Database/business statuses are: 'Pending' | 'Completed' | 'Failed'
 * (Supabase) and 'pending' | 'processing' | 'completed' | 'failed'
 * (PaymentSession in localStorage). Those are orthogonal to this type.
 */
export type PaymentFrontendStatus =
  | 'success'
  | 'processing'
  | 'failed'
  | 'banking_issue'
  | 'verification_pending';

/**
 * Canonical database/ledger payment status (Supabase).
 * This is what actually gets persisted — completely separate from
 * PaymentFrontendStatus.
 */
export type PaymentDatabaseStatus = 'Pending' | 'Completed' | 'Failed';

/**
 * Canonical session/localStorage status.
 * Also completely separate from PaymentFrontendStatus.
 */
export type PaymentSessionStatus = 'pending' | 'processing' | 'completed' | 'failed';

// ─── Internal Razorpay reason → frontend state map ───────────────────────────

const FAILED_REASONS = new Set([
  'insufficient_fund',
  'payment_cancelled',
  'card_declined',
  'authentication_failed',
  'card_disabled_for_online_payments',
  'card_number_invalid',
  // additional normalized variants
  'BAD_REQUEST_ERROR',
  'user_cancelled',
]);

const BANKING_ISSUE_REASONS = new Set([
  'payment_timed_out',
  'gateway_technical_error',
  'GATEWAY_ERROR',
  'SERVER_ERROR',
]);

/**
 * Map a Razorpay error code/reason to one of the five frontend states.
 * Source: from payment.failed event on Razorpay checkout.
 */
export function mapRazorpayErrorToState(
  errorCode?: string,
  errorReason?: string
): PaymentFrontendStatus {
  const reason = (errorReason || '').toLowerCase();
  const code = (errorCode || '').toLowerCase();

  // Explicit failed reasons
  if (
    FAILED_REASONS.has(errorReason || '') ||
    FAILED_REASONS.has(code) ||
    reason === 'payment_cancelled' ||
    reason === 'user_cancelled' ||
    reason === 'insufficient_fund' ||
    reason === 'card_declined' ||
    reason === 'authentication_failed' ||
    reason === 'card_disabled_for_online_payments' ||
    reason === 'card_number_invalid'
  ) {
    return 'failed';
  }

  // Banking issue reasons
  if (
    BANKING_ISSUE_REASONS.has(errorReason || '') ||
    BANKING_ISSUE_REASONS.has(code) ||
    reason === 'payment_timed_out' ||
    reason === 'gateway_technical_error'
  ) {
    return 'banking_issue';
  }

  // User dismissed / cancelled modal explicitly
  if (errorCode === 'USER_CANCELLED') {
    return 'failed';
  }

  // Unknown → default to failed for gateway checkout failures
  return 'failed';
}

/**
 * Map a /api/payment/recover API response `status` field → frontend UI state.
 *
 * NOTE: This is the only place the recover API's `status` string is consumed.
 * The string is NEVER forwarded to any database — it exists solely as a
 * transport value between the API and this mapping function.
 * `verification_pending` in particular must remain a UI-only concept.
 */
export function mapRecoverStatusToState(
  apiStatus: string
): PaymentFrontendStatus {
  switch (apiStatus) {
    case 'success':
    case 'already_processed':
      return 'success';
    case 'processing':
      return 'processing';
    case 'failed':
      return 'failed';
    case 'not_found':
      return 'failed'; // No payment found — safe to retry
    default:
      return 'verification_pending';
  }
}

// ─── Student-facing copy for each state ──────────────────────────────────────

export interface PaymentStateContent {
  title: string;
  lines: string[];
  /** Timeout message shown when polling gives up */
  timeoutMessage?: string;
}

export const PAYMENT_STATE_CONTENT: Record<PaymentFrontendStatus, PaymentStateContent> = {
  success: {
    title: 'Payment Received',
    lines: [
      'Payment received successfully.',
      'We are updating your application.',
      'This usually takes only a few seconds.',
    ],
  },
  processing: {
    title: 'Confirming Payment',
    lines: [
      'We are confirming your payment with Razorpay.',
      'Please do not make another payment.',
      'This usually completes within a few moments.',
    ],
    timeoutMessage:
      'We are still waiting for payment confirmation. You may safely close this page. Your payment will be verified automatically the next time you open the application.',
  },
  failed: {
    title: 'Payment Not Completed',
    lines: [
      'Your payment was not completed.',
      'No transport service has been activated.',
      'Please try again using the same or another payment method.',
    ],
  },
  banking_issue: {
    title: 'Banking Delay',
    lines: [
      'Your bank or the payment gateway is taking longer than expected.',
      'If any amount has been debited, it will either be confirmed automatically or refunded by your bank according to their policy.',
      'Please wait a few minutes before trying again.',
    ],
  },
  verification_pending: {
    title: 'Verifying Payment',
    lines: [
      'We cannot confirm your payment yet.',
      'We are verifying it securely with Razorpay.',
      'If your payment has been captured, your application will update automatically.',
    ],
  },
};

/**
 * Get highly detailed, student-friendly, and actionable status messages
 * based on the frontend status, error code, and error reason.
 */
export function getFriendlyPaymentStateContent(
  status: PaymentFrontendStatus,
  errorCode?: string,
  errorReason?: string
): PaymentStateContent {
  const reason = (errorReason || '').toLowerCase();
  const code = (errorCode || '').toLowerCase();

  if (status === 'failed') {
    // 1. Payment Cancelled
    if (
      reason === 'payment_cancelled' ||
      reason === 'user_cancelled' ||
      code === 'user_cancelled' ||
      errorCode === 'USER_CANCELLED'
    ) {
      return {
        title: 'Payment Cancelled',
        lines: [
          'The transaction was cancelled before completion.',
          'No money was debited from your account.',
          'You can safely try again whenever you are ready.',
        ],
      };
    }

    // 2. Insufficient Funds
    if (reason === 'insufficient_fund' || code === 'insufficient_fund') {
      return {
        title: 'Insufficient Balance',
        lines: [
          'The transaction failed because there are insufficient funds in your account.',
          'No money was debited from your account.',
          'Please check your balance, transfer funds, or try a different payment method or UPI ID.',
        ],
      };
    }

    // 3. Authentication Failed
    if (reason === 'authentication_failed' || code === 'authentication_failed') {
      return {
        title: 'Verification Failed',
        lines: [
          'The secure verification (OTP or authorization) failed or timed out.',
          'No money was debited from your account.',
          'Please try again and make sure to enter the correct OTP within the time limit.',
        ],
      };
    }

    // 4. Card Declined / Disabled / Invalid
    if (
      reason === 'card_declined' ||
      code === 'card_declined' ||
      reason === 'card_disabled_for_online_payments' ||
      code === 'card_disabled_for_online_payments' ||
      reason === 'card_number_invalid' ||
      code === 'card_number_invalid'
    ) {
      return {
        title: 'Card Declined by Bank',
        lines: [
          'Your bank declined this transaction. This can happen due to incorrect details or disabled online usage.',
          'No money was debited from your account.',
          'Please verify your card details, check online usage settings in your bank app, or use UPI.',
        ],
      };
    }

    // Default Failed
    return {
      title: 'Payment Not Completed',
      lines: [
        'Your transaction could not be completed.',
        'No money has been debited. If any amount was deducted, it will be refunded by your bank automatically.',
        'Please try again or use another payment method.',
      ],
    };
  }

  if (status === 'banking_issue') {
    // 5. Payment Timed Out
    if (reason === 'payment_timed_out' || code === 'payment_timed_out') {
      return {
        title: 'Transaction Timed Out',
        lines: [
          'The transaction took too long and timed out at the payment gateway.',
          'If any money was debited from your account, it will be automatically refunded by your bank within 3-5 business days.',
          'Please check your bank statement before making another payment attempt.',
        ],
      };
    }

    // 6. Gateway Technical Error
    if (
      reason === 'gateway_technical_error' ||
      code === 'gateway_technical_error' ||
      reason === 'gateway_error' ||
      code === 'gateway_error' ||
      reason === 'server_error' ||
      code === 'server_error'
    ) {
      return {
        title: 'Gateway Technical Issue',
        lines: [
          'The payment gateway or bank servers are experiencing technical difficulties.',
          'If money was debited from your account, it will be refunded automatically or verified shortly.',
          'Please wait a few minutes before retrying, or choose a different payment method.',
        ],
      };
    }

    // Default Banking Issue
    return {
      title: 'Banking Delay',
      lines: [
        'Your bank or the payment gateway is taking longer than expected.',
        'If any amount has been debited, it will either be confirmed automatically or refunded by your bank according to their policy.',
        'Please wait a few minutes before trying again.',
      ],
    };
  }

  // Fallback to the standard static state content for other states
  return PAYMENT_STATE_CONTENT[status];
}

// ─── Retry / polling config ───────────────────────────────────────────────────

export const RECOVERY_POLL_INTERVAL_MS = 9000; // 9 seconds
export const RECOVERY_MAX_ATTEMPTS = 5;
export const RECOVERY_TIMEOUT_MS = RECOVERY_POLL_INTERVAL_MS * RECOVERY_MAX_ATTEMPTS; // ~45s
