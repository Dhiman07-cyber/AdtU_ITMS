"use client";

import { Button } from '@/components/ui/button';
import {
	PaymentFrontendStatus,
	getFriendlyPaymentStateContent,
} from '@/lib/payment/payment-state';
import { AnimatePresence,motion } from 'framer-motion';
import {
	AlertTriangle,
	CheckCircle,
	Clock,
	Loader2,
	RefreshCw,
	XCircle,
} from 'lucide-react';
import React from 'react';

interface PaymentStatusPanelProps {
  status: PaymentFrontendStatus;
  isPolling: boolean;
  timedOut: boolean;
  errorCode?: string;
  errorReason?: string;
  /** Show the manual "Check Payment Status" button */
  onManualCheck?: () => void;
  /** Show the "Try Again" button (only for failed / banking_issue) */
  onRetry?: () => void;
  /** Extra classes on the outer container */
  className?: string;
}

const STATUS_META: Record<
  PaymentFrontendStatus,
  {
    icon: React.ReactNode;
    iconBg: string;
    iconRing: string;
    titleColor: string;
    bodyColor: string;
    containerBg: string;
    containerBorder: string;
  }
> = {
  success: {
    icon: <CheckCircle className="h-7 w-7 text-emerald-400" />,
    iconBg: 'bg-emerald-500/10',
    iconRing: 'border-emerald-500/20',
    titleColor: 'text-emerald-300',
    bodyColor: 'text-emerald-100/80',
    containerBg: 'bg-emerald-900/20',
    containerBorder: 'border-emerald-500/25',
  },
  processing: {
    icon: <Loader2 className="h-7 w-7 text-blue-400 animate-spin" />,
    iconBg: 'bg-blue-500/10',
    iconRing: 'border-blue-500/20',
    titleColor: 'text-blue-300',
    bodyColor: 'text-blue-100/80',
    containerBg: 'bg-blue-900/20',
    containerBorder: 'border-blue-500/25',
  },
  failed: {
    icon: <XCircle className="h-7 w-7 text-red-400" />,
    iconBg: 'bg-red-500/10',
    iconRing: 'border-red-500/20',
    titleColor: 'text-red-300',
    bodyColor: 'text-red-100/80',
    containerBg: 'bg-red-900/20',
    containerBorder: 'border-red-500/25',
  },
  banking_issue: {
    icon: <AlertTriangle className="h-7 w-7 text-amber-400" />,
    iconBg: 'bg-amber-500/10',
    iconRing: 'border-amber-500/20',
    titleColor: 'text-amber-300',
    bodyColor: 'text-amber-100/80',
    containerBg: 'bg-amber-900/20',
    containerBorder: 'border-amber-500/25',
  },
  verification_pending: {
    icon: <Clock className="h-7 w-7 text-violet-400" />,
    iconBg: 'bg-violet-500/10',
    iconRing: 'border-violet-500/20',
    titleColor: 'text-violet-300',
    bodyColor: 'text-violet-100/80',
    containerBg: 'bg-violet-900/20',
    containerBorder: 'border-violet-500/25',
  },
};

export function PaymentStatusPanel({
  status,
  isPolling,
  timedOut,
  errorCode,
  errorReason,
  onManualCheck,
  onRetry,
  className = '',
}: PaymentStatusPanelProps) {
  const content = getFriendlyPaymentStateContent(status, errorCode, errorReason);
  const meta = STATUS_META[status];

  const showRetry = status === 'failed' || status === 'banking_issue';
  const showCheckStatus =
    !isPolling &&
    (status === 'processing' ||
      status === 'verification_pending' ||
      status === 'banking_issue');

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={status}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className={`rounded-2xl border ${meta.containerBg} ${meta.containerBorder} p-4 sm:p-5 space-y-3 ${className}`}
      >
        {/* Icon + Title */}
        <div className="flex items-center gap-3">
          <div
            className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center border ${meta.iconBg} ${meta.iconRing}`}
          >
            {meta.icon}
          </div>
          <div>
            <p className={`text-sm font-bold ${meta.titleColor}`}>
              {content.title}
            </p>
            {isPolling && status !== 'success' && (
              <p className="text-[10px] text-white/40 mt-0.5 font-medium">
                Checking automatically…
              </p>
            )}
          </div>
        </div>

        {/* Lines */}
        <div className="space-y-1.5 pl-1">
          {(timedOut && content.timeoutMessage
            ? [content.timeoutMessage]
            : content.lines
          ).map((line, i) => (
            <p key={i} className={`text-xs leading-relaxed ${meta.bodyColor}`}>
              {line}
            </p>
          ))}
        </div>

        {/* Action buttons */}
        {(showRetry || showCheckStatus) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {showCheckStatus && onManualCheck && (
              <Button
                size="sm"
                variant="outline"
                onClick={onManualCheck}
                className="h-8 text-xs font-semibold border-white/20 bg-white/5 hover:bg-white/10 text-white gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Check Payment Status
              </Button>
            )}
            {showRetry && onRetry && status === 'failed' && (
              <Button
                size="sm"
                onClick={onRetry}
                className="h-8 text-xs font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/20"
              >
                Try Again
              </Button>
            )}
            {showRetry && onRetry && status === 'banking_issue' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onManualCheck}
                  className="h-8 text-xs font-semibold border-white/20 bg-white/5 hover:bg-white/10 text-white gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Check Payment Status
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onRetry}
                  className="h-8 text-xs font-semibold text-white/60 hover:text-white hover:bg-white/10"
                >
                  Try Again Later
                </Button>
              </>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
