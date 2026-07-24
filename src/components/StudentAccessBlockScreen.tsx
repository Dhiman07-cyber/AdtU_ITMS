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

  // Visual Theme Tokens (Crisp, fast, solid backgrounds - no heavy blurs/filters)
  const theme = isUpcoming
    ? {
      border: 'border-indigo-500/40',
      headerGradient: 'from-indigo-950/60 to-purple-950/20',
      badgeBg: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
      iconBg: 'bg-indigo-600 text-white',
      titleColor: 'text-indigo-300',
      cardBg: 'bg-[#0f111a]',
      statusText: 'Verified • Upcoming Session',
    }
    : isQueue
      ? {
        border: 'border-amber-500/40',
        headerGradient: 'from-amber-950/60 to-orange-950/20',
        badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        iconBg: 'bg-amber-600 text-white',
        titleColor: 'text-amber-300',
        cardBg: 'bg-[#14110b]',
        statusText: 'Verified • Seat Queue Active',
      }
      : isSubmitted
        ? {
          border: 'border-blue-500/40',
          headerGradient: 'from-blue-950/60 to-cyan-950/20',
          badgeBg: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
          iconBg: 'bg-blue-600 text-white',
          titleColor: 'text-blue-300',
          cardBg: 'bg-[#0c121e]',
          statusText: 'Under Review • Application Submitted',
        }
        : {
          border: 'border-rose-500/40',
          headerGradient: 'from-rose-950/60 to-red-950/20',
          badgeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
          iconBg: 'bg-rose-600 text-white',
          titleColor: 'text-rose-300',
          cardBg: 'bg-[#180e11]',
          statusText: 'Service Inactive • Renewal Required',
        };

  return (
    <div className="fixed inset-0 z-[1000] bg-black/80 flex items-center justify-center overflow-y-auto overscroll-contain p-4 sm:p-6">
      <div className={`max-w-xl w-full ${theme.cardBg} ${theme.border} border rounded-2xl overflow-hidden shadow-2xl`}>

        {/* Header Banner */}
        <div className={`p-6 sm:p-7 bg-gradient-to-b ${theme.headerGradient} border-b border-white/10`}>
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${theme.iconBg} shrink-0`}>
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
              <div className={`inline-flex items-center px-3 py-0.5 rounded-full text-xs font-medium border ${theme.badgeBg} mb-1.5`}>
                {theme.statusText}
              </div>
              <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                {headlineTitle}
              </h1>
            </div>
          </div>
        </div>

        {/* Card Content Body */}
        <div className="p-6 sm:p-7 space-y-5">

          {/* Main Message Block */}
          <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-1.5">
            <h2 className="text-xs sm:text-sm font-semibold text-zinc-200">
              Dear <strong className="text-white font-bold">{studentName}</strong>,
            </h2>
            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
              {headlineDetail}
            </p>
          </div>

          {/* Structured Progress Checklist for Upcoming Session */}
          {isUpcoming && (
            <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/30 space-y-3">
              <div className="flex items-center gap-2 text-indigo-300 font-bold text-xs uppercase tracking-wider">
                <Clock className="h-4 w-4 text-indigo-400" />
                <span>Session Activation Roadmap</span>
              </div>
              <div className="space-y-2.5 pt-1">
                <div className="flex items-start gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1 shrink-0" />
                  <div>
                    <h3 className="text-xs font-semibold text-emerald-300">Registration & Verification Completed</h3>
                    <p className="text-[11px] text-zinc-400">Your application details and payment proof have been verified by transport administration.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 mt-1 shrink-0" />
                  <div>
                    <h3 className="text-xs font-semibold text-indigo-300">Awaiting Session Start Date</h3>
                    <p className="text-[11px] text-zinc-400">Seat allocation and bus assignment will activate automatically when the new academic term starts.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="w-2 h-2 rounded-full bg-zinc-600 mt-1 shrink-0" />
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-400">Transit Pass & Tracking Activation</h3>
                    <p className="text-[11px] text-zinc-500">Your digital QR transit pass and live bus tracking portal will unlock on the first day of the new term.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Structured Progress Checklist for Queue */}
          {isQueue && (
            <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/30 space-y-3">
              <div className="flex items-center gap-2 text-amber-300 font-bold text-xs uppercase tracking-wider">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span>Seat Queue Status</span>
              </div>
              <div className="space-y-2.5 pt-1">
                <div className="flex items-start gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1 shrink-0" />
                  <div>
                    <h3 className="text-xs font-semibold text-emerald-300">Verification Confirmed</h3>
                    <p className="text-[11px] text-zinc-400">Your application and payment details have been verified.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 mt-1 shrink-0" />
                  <div>
                    <h3 className="text-xs font-semibold text-amber-300">Priority Seat Queue</h3>
                    <p className="text-[11px] text-zinc-400">You are queued for seat allocation. Your pass will issue automatically when a seat becomes available.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Structured Progress Checklist for Submitted Applications */}
          {isSubmitted && (
            <div className="p-4 rounded-xl bg-blue-950/30 border border-blue-500/30 space-y-3">
              <div className="flex items-center gap-2 text-blue-300 font-bold text-xs uppercase tracking-wider">
                <Clock className="h-4 w-4 text-blue-400" />
                <span>Verification Timeline</span>
              </div>
              <div className="space-y-2.5 pt-1">
                <div className="flex items-start gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1 shrink-0" />
                  <div>
                    <h3 className="text-xs font-semibold text-emerald-300">Application Submitted</h3>
                    <p className="text-[11px] text-zinc-400">Registration details and payment proof have been received.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-blue-400 mt-1 shrink-0" />
                  <div>
                    <h3 className="text-xs font-semibold text-blue-300">Administrative Review</h3>
                    <p className="text-[11px] text-zinc-400">Transport administrators are reviewing your documents (typically 1 to 2 business days).</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-zinc-600 mt-1 shrink-0" />
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-400">Portal & Bus Pass Activation</h3>
                    <p className="text-[11px] text-zinc-500">Your student dashboard and transit pass will activate upon verification approval.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Contact Office Info */}
          {contactInfo && (
            <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 space-y-1">
              <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-indigo-400" />
                <span>Transport Office Contact</span>
              </h3>
              <div className="text-xs text-zinc-400 space-y-0.5 pl-5">
                <p>{contactInfo.officeName}: <strong className="text-zinc-200">{contactInfo.phone}</strong></p>
                <p>Email: <strong className="text-zinc-200">{contactInfo.email}</strong></p>
              </div>
            </div>
          )}

          {/* Renewal CTA — Rendered only for expired/inactive students */}
          {needsRenewal && (
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 space-y-2.5">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-emerald-400" />
                <h3 className="font-bold text-emerald-200 text-xs uppercase tracking-wider">
                  Renew Transport Service
                </h3>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">
                Submit a renewal request online or offline to reactivate your digital transit pass and live tracking access.
              </p>
              <Button
                onClick={() => router.push('/student/renew-services')}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold h-10 rounded-lg text-xs"
              >
                <CreditCard className="mr-2 h-4 w-4" />
                Renew Service Now
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Bottom Actions */}
          <div className="flex gap-3 pt-1">
            <Button
              onClick={() => window.location.reload()}
              variant="outline"
              className="flex-1 bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10 hover:text-white h-9 rounded-lg text-xs"
            >
              Refresh Status
            </Button>
            {onLogout && (
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await onLogout();
                  } catch (e) {
                    console.error('Logout error:', e);
                  }
                  router.push('/login');
                }}
                className="flex-1 bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10 hover:text-white h-9 rounded-lg text-xs"
              >
                Sign Out
              </Button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
