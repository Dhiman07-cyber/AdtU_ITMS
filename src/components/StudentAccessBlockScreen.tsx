"use client";

import { useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, XCircle, Phone, Mail, CreditCard, ArrowRight, Clock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getDaysUntilHardDelete, getBlockingMessage, getContactInfo, getHardDeleteDate } from '@/lib/utils/renewal-utils';
import { EntitlementReason, ENTITLEMENT_MESSAGES } from '@/lib/entitlement/transport-entitlement';

interface StudentAccessBlockScreenProps {
  validUntil: string | null;
  studentName: string;
  onLogout?: () => void;
  deadlineConfig?: any;
  /** Phase 3 — why transport access is unavailable (drives the headline copy). */
  reason?: EntitlementReason;
}

/**
 * Full-screen lifecycle screen for students who do NOT currently own transport
 * access (soft-blocked, past soft-block, or expired).
 *
 * Phase 3: this is the single lifecycle/messaging surface reused by the transport
 * entitlement guard, the track-bus/bus pages, and the dashboard. It always tells
 * the student: current status, WHY access is unavailable, the required action
 * (renew), and what happens next (admin approval — NOT instant reactivation).
 *
 * It tolerates a missing `deadlineConfig` (the hard-delete countdown + contact
 * block are simply omitted) so it can render immediately while config loads.
 */
export default function StudentAccessBlockScreen({
  validUntil,
  studentName,
  onLogout,
  deadlineConfig,
  reason,
}: StudentAccessBlockScreenProps) {
  const router = useRouter();

  // Config-dependent details are optional — only computed when config is present.
  let daysUntilDelete = 0;
  let hardDeleteDateFormatted = '';
  let contactInfo: any = null;
  if (deadlineConfig) {
    try {
      daysUntilDelete = getDaysUntilHardDelete(validUntil, null, deadlineConfig);
      contactInfo = getContactInfo(deadlineConfig);
      hardDeleteDateFormatted = getHardDeleteDate(validUntil, null, deadlineConfig).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      contactInfo = null;
    }
  }

  // Reason-aware headline + explanation (falls back to the generic expiry message).
  const reasonCopy = reason ? ENTITLEMENT_MESSAGES[reason] : null;
  const headlineDetail = (() => {
    if (deadlineConfig) {
      try {
        return getBlockingMessage(validUntil, null, deadlineConfig);
      } catch {
        /* fall through */
      }
    }
    return reasonCopy?.detail ?? 'Your bus service is not active. Please renew your service to restore transport access.';
  })();
  const headlineTitle = reasonCopy?.title ?? 'Bus Service Inactive';

  // Prevent background scrolling while the overlay is open
  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyClass = document.body.className;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    // Mark body so layout can hide navbar
    document.body.classList.add('block-overlay');

    // Hide StudentLayout bottom nav
    const bottomNav = document.getElementById('student-bottom-nav');
    if (bottomNav) bottomNav.setAttribute('data-hidden', 'true');

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.className = previousBodyClass;
      // Restore bottom nav
      if (bottomNav) bottomNav.removeAttribute('data-hidden');
    };
  }, []);

  const isUpcoming = reason === 'verified_upcoming';
  const isQueue = reason === 'pending_seat_allocation';
  const isSubmitted = reason === 'application_submitted';
  const isNonEntitledActive = isUpcoming || isQueue || isSubmitted;
  const needsRenewal = !isNonEntitledActive;

  const cardBorderClass = isUpcoming
    ? 'border-indigo-500'
    : isQueue
    ? 'border-amber-500'
    : isSubmitted
    ? 'border-blue-500'
    : 'border-red-500';

  const headerBgClass = isUpcoming
    ? 'bg-indigo-900/30 border-indigo-700'
    : isQueue
    ? 'bg-amber-900/30 border-amber-700'
    : isSubmitted
    ? 'bg-blue-900/30 border-blue-700'
    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';

  const headerTitleClass = isUpcoming
    ? 'text-indigo-400'
    : isQueue
    ? 'text-amber-400'
    : isSubmitted
    ? 'text-blue-400'
    : 'text-red-700 dark:text-red-400';

  return (
    <div className="fixed inset-0 z-[1000] bg-background/90 backdrop-blur-sm flex items-start justify-center overflow-y-auto overscroll-contain pt-20 pb-8 px-4">
      <Card className={`max-w-lg w-full ${cardBorderClass} border-2 shadow-2xl flex flex-col bg-zinc-900`}>
        <CardHeader className={`${headerBgClass} border-b py-4`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full ${isUpcoming ? 'bg-indigo-600' : isQueue ? 'bg-amber-600' : isSubmitted ? 'bg-blue-600' : 'bg-red-500'}`}>
              {isUpcoming ? (
                <Clock className="h-6 w-6 text-white" />
              ) : isQueue ? (
                <AlertTriangle className="h-6 w-6 text-white" />
              ) : isSubmitted ? (
                <Clock className="h-6 w-6 text-white" />
              ) : (
                <XCircle className="h-6 w-6 text-white" />
              )}
            </div>
            <div>
              <CardTitle className={`text-xl ${headerTitleClass}`}>
                {headlineTitle}
              </CardTitle>
              <CardDescription className="text-zinc-300 mt-1">
                {isUpcoming
                  ? 'Application Approved • Awaiting Session Start'
                  : isQueue
                  ? 'Application Approved • Seat Queue Active'
                  : isSubmitted
                  ? 'Application Submitted • Under Review'
                  : 'Transport access is restricted'}
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-4 space-y-4">
          {/* Main Message */}
          <div className={`p-4 rounded-lg border ${isUpcoming ? 'bg-indigo-950/40 border-indigo-800 text-indigo-200' : isQueue ? 'bg-amber-950/40 border-amber-800 text-amber-200' : isSubmitted ? 'bg-blue-950/40 border-blue-800 text-blue-200' : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'}`}>
            <div className="flex gap-3">
              <AlertTriangle className={`h-6 w-6 flex-shrink-0 mt-1 ${isUpcoming ? 'text-indigo-400' : isQueue ? 'text-amber-400' : isSubmitted ? 'text-blue-400' : 'text-yellow-600 dark:text-yellow-400'}`} />
              <div className="flex-1">
                <p className="font-semibold mb-2">
                  Dear {studentName},
                </p>
                <p className="text-sm leading-relaxed opacity-90">
                  {headlineDetail}
                </p>
              </div>
            </div>
          </div>

          {/* Upcoming Session Informational Status Box */}
          {isUpcoming && (
            <div className="p-4 bg-gradient-to-r from-indigo-900/30 to-purple-900/30 border border-indigo-600/50 rounded-xl space-y-3">
              <div className="flex items-center gap-2 text-indigo-300 font-bold text-base">
                <Clock className="h-5 w-5 text-indigo-400" />
                <span>Next Steps for Upcoming Session</span>
              </div>
              <ul className="text-xs text-indigo-200 space-y-2 list-disc list-inside leading-relaxed">
                <li>Your seat selection and application details are locked and saved.</li>
                <li>Your student transit pass and live bus tracking map will automatically unlock when the new session begins.</li>
                <li>No further action or payment is required from your end.</li>
              </ul>
            </div>
          )}

          {/* Contact Information - when available */}
          {contactInfo && (
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-3">
                Contact Admin Office
              </h3>
              <div className="space-y-2 text-sm text-blue-700 dark:text-blue-300">
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  <span>{contactInfo.officeName}: {contactInfo.phone}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  <span>Email: {contactInfo.email}</span>
                </div>
              </div>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-3">
                {contactInfo.visitInstructions}
              </p>
            </div>
          )}

          {/* Warning - Dynamic Threshold (only when config is available and needs renewal) */}
          {needsRenewal && daysUntilDelete > 0 && daysUntilDelete <= (deadlineConfig?.urgentWarningThreshold?.days || 15) && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <AlertTriangle className="h-5 w-5" />
                <p className="font-semibold text-sm">
                  URGENT: Only {daysUntilDelete} days remaining before permanent deletion!
                </p>
              </div>
              <p className="text-xs text-red-600 dark:text-red-300 mt-2">
                After {hardDeleteDateFormatted}, your account and all associated data will be permanently deleted and cannot be recovered.
              </p>
            </div>
          )}

          {/* Renewal CTA — Only rendered when student actually needs to renew */}
          {needsRenewal && (
            <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-2 border-green-300 dark:border-green-700 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="h-5 w-5 text-green-600" />
                <h3 className="font-bold text-green-800 dark:text-green-200">
                  Renew Your Service
                </h3>
              </div>
              <p className="text-sm text-green-700 dark:text-green-300 mb-1">
                Submit a renewal to get your transport access back.
              </p>
              <p className="text-xs text-green-600/90 dark:text-green-300/80 mb-3">
                After you pay (online or offline), your renewal is reviewed and approved by an administrator. Transport access — tracking, bus pass, and trip access — is restored once your renewal is approved.
              </p>
              <Button
                onClick={() => router.push('/student/renew-services')}
                className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg"
                size="lg"
              >
                <CreditCard className="mr-2 h-5 w-5" />
                Renew Service
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            {onLogout && (
              <Button
                variant="outline"
                onClick={onLogout}
                className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              >
                Sign Out
              </Button>
            )}
            <Button
              onClick={() => router.push('/student')}
              variant="outline"
              className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              Back to Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
