'use client';

import React, { useEffect, useState } from 'react';

/**
 * Premium Page Content Loader
 * Core loading UI for ADTU Bus Services
 */
export function PremiumPageLoader({
  message = "Loading experience...",
  subMessage = "Optimizing your dashboard...",
  noWrapper = false,
  fullScreen = false,
  className = "",
  maxDurationMs = 4500,
  onTimeout,
  fallback,
}: {
  message?: string;
  subMessage?: string;
  noWrapper?: boolean;
  fullScreen?: boolean;
  className?: string;
  maxDurationMs?: number;
  onTimeout?: () => void;
  fallback?: React.ReactNode;
}) {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!maxDurationMs) return;
    const timer = setTimeout(() => {
      setTimedOut(true);
      onTimeout?.();
    }, maxDurationMs);
    return () => clearTimeout(timer);
  }, [maxDurationMs, onTimeout]);

  if (timedOut && fallback) return <>{fallback}</>;

  const content = (
    <div className="flex flex-col items-center gap-3.5 text-center">
      <div className="relative scale-110 sm:scale-125">
        {/* Ambient Glows */}
        <div className="absolute -inset-10 bg-pink-500/15 blur-[40px] animate-pulse rounded-full" />
        <div className="absolute -inset-10 bg-purple-500/10 blur-[30px] animate-pulse delay-700 rounded-full" />

        {/* Main Spinner Container */}
        <div className="relative z-10">
          <div className="pink-purple-spinner bg-dark-blue shadow-2xl shadow-pink-500/30"></div>
          {/* Inner pulse ring */}
          <div className="absolute inset-0 border border-white/5 rounded-full scale-150 opacity-20 animate-ping" />
        </div>
      </div>

      <div className="space-y-2.5 z-10 w-full max-w-xl mt-1 px-4">
        <h3 className="text-base sm:text-lg md:text-xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-indigo-400 bg-clip-text text-transparent animate-pulse tracking-tight leading-tight sm:whitespace-nowrap">
          {message}
        </h3>
        <p className="text-[9px] sm:text-[10px] text-zinc-500 dark:text-zinc-500 font-black uppercase tracking-[0.2em] opacity-80 leading-relaxed sm:whitespace-nowrap">
          {subMessage}
        </p>
      </div>
    </div>
  );

  if (noWrapper) return content;

  return (
    <div
      className={`flex flex-col items-center justify-center w-full p-6 text-center relative overflow-hidden ${
        fullScreen
          ? 'fixed inset-0 min-h-dvh bg-slate-950/80 backdrop-blur-sm z-50'
          : 'min-h-[calc(100dvh-48px)] flex-grow'
      } ${className}`}
    >
      <div className="w-full flex flex-col items-center gap-5 mt-0 md:mt-[-10dvh] relative z-10">
        {content}
      </div>
    </div>
  );
}

/**
 * Mobile Typewriter Loader
 */
export function MobileTypewriterLoader({
  className = "",
  fullScreen = true,
}: {
  className?: string;
  fullScreen?: boolean;
}) {
  const [displayText, setDisplayText] = useState('');
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const phrases = ["Salvaging Details...", "Striving Information..."];
    const currentPhrase = phrases[phraseIndex];
    let timer: NodeJS.Timeout;

    if (!isDeleting) {
      if (displayText.length < currentPhrase.length) {
        timer = setTimeout(() => {
          setDisplayText(currentPhrase.slice(0, displayText.length + 1));
        }, 90);
      } else {
        timer = setTimeout(() => {
          setIsDeleting(true);
        }, 1800);
      }
    } else {
      if (displayText.length > 0) {
        timer = setTimeout(() => {
          setDisplayText(currentPhrase.slice(0, displayText.length - 1));
        }, 60);
      } else {
        setIsDeleting(false);
        setPhraseIndex((prev) => (prev + 1) % phrases.length);
      }
    }

    return () => clearTimeout(timer);
  }, [displayText, isDeleting, phraseIndex]);

  return (
    <div
      className={`flex flex-col items-center justify-center w-full p-6 relative z-50 ${
        fullScreen ? 'fixed inset-0 bg-[#05060e] min-h-dvh' : 'min-h-[250px]'
      } ${className}`}
    >
      <div className="flex flex-col items-center gap-6 max-w-[280px] w-full text-center">
        <div>
          <img
            src="/adtu-new-logo.svg"
            alt="AdtU Logo"
            className="w-36 h-auto object-contain"
            loading="eager"
            fetchPriority="high"
          />
        </div>
        <div className="relative">
          <div className="w-10 h-10 sm:w-12 sm:h-12 border-3 sm:border-4 border-gray-200 dark:border-gray-700 rounded-full animate-spin border-t-blue-600"></div>
        </div>
        <div className="h-5 flex items-center justify-center">
          <span className="text-sm font-semibold text-slate-300 tracking-wide font-mono flex items-center">
            {displayText}
            <span className="inline-block w-[1.5px] h-3 ml-1 bg-blue-500 animate-pulse" />
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Full Screen Loading Overlay
 */
export function FullScreenLoader({ message = "Please wait..." }: { message?: string }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      data-nextjs-scroll-focus-boundary
    >
      <div className="flex flex-col items-center gap-3 bg-white dark:bg-gray-900 p-6 sm:p-8 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700">
        <div className="relative">
          <div className="w-10 h-10 sm:w-12 sm:h-12 border-3 sm:border-4 border-gray-200 dark:border-gray-700 rounded-full animate-spin border-t-blue-600"></div>
        </div>
        <p className="text-base sm:text-lg font-semibold text-gray-800 dark:text-gray-200">{message}</p>
      </div>
    </div>
  );
}

/**
 * Inline Button Loading
 */
export function ButtonLoader({ text = "Processing..." }: { text?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-4 h-4 border-2 border-white/30 rounded-full animate-spin border-t-white"></div>
      <span>{text}</span>
    </div>
  );
}

/**
 * Table Loading Skeleton
 */
export function TableLoader({ rows = 5, columns = 6, className = "" }: { rows?: number; columns?: number; className?: string }) {
  return <TableRowLoader rows={rows} className={className} />;
}

/**
 * Unified Table Row Loading Skeleton (Single Animation Per Row)
 * Replaces separate per-column/per-field boxes with a single cohesive row animation.
 */
export function TableRowLoader({ rows = 6, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-3 w-full ${className}`}>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="h-12 w-full rounded-xl bg-slate-200/50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800/60 animate-pulse relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-slate-300/30 dark:via-white/[0.04] to-transparent" />
        </div>
      ))}
    </div>
  );
}

/**
 * Card Loading Skeleton
 */
export function CardLoader() {
  return (
    <div className="bg-white dark:bg-gray-900 p-6 rounded-lg shadow animate-pulse">
      <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-1/3 mb-4" />
      <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded w-1/2" />
    </div>
  );
}

/**
 * Minimal Spinner
 */
export function MiniLoader({ className = "" }: { className?: string }) {
  return (
    <div
      className={`w-4 h-4 border-2 border-gray-300 dark:border-gray-600 rounded-full animate-spin border-t-blue-600 ${className}`}
    ></div>
  );
}

/**
 * Page Content Loader
 */
export function PageLoader({ message = "Please wait..." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100dvh-48px)] flex-grow gap-3 sm:gap-4 w-full">
      <div className="relative">
        <div className="w-10 h-10 sm:w-12 sm:h-12 border-3 sm:border-4 border-gray-200 dark:border-gray-700 rounded-full animate-spin border-t-blue-600"></div>
      </div>
      <p className="text-base sm:text-lg font-medium text-gray-700 dark:text-gray-300">{message}</p>
    </div>
  );
}

/**
 * Metric Card Skeleton (KPI Card)
 */
export function MetricCardSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40 p-5 backdrop-blur-md animate-pulse">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="h-4 w-28 bg-white/10 rounded-md" />
        <div className="h-9 w-9 bg-white/10 rounded-xl" />
      </div>
      <div className="h-7 w-20 bg-white/15 rounded-md mb-2" />
      <div className="h-3 w-32 bg-white/5 rounded-md" />
    </div>
  );
}

/**
 * Chart Skeleton
 */
export function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div
      style={{ height }}
      className="w-full rounded-2xl border border-white/5 bg-slate-900/40 p-6 backdrop-blur-md animate-pulse flex flex-col justify-between"
    >
      <div className="flex justify-between items-center mb-4">
        <div className="h-5 w-36 bg-white/10 rounded-md" />
        <div className="h-4 w-20 bg-white/5 rounded-md" />
      </div>
      <div className="flex-1 flex items-end gap-3 pt-6 pb-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 bg-white/10 rounded-t-lg transition-all"
            style={{ height: `${20 + ((i * 17) % 70)}%` }}
          />
        ))}
      </div>
      <div className="h-3 w-full bg-white/5 rounded mt-3" />
    </div>
  );
}

/**
 * Map Container Skeleton
 */
export function MapContainerSkeleton({ className = "h-[450px]" }: { className?: string }) {
  return (
    <div className={`w-full rounded-3xl border border-white/10 bg-slate-950/60 backdrop-blur-md flex flex-col items-center justify-center relative overflow-hidden animate-pulse ${className}`}>
      <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/5 via-indigo-500/5 to-purple-500/5" />
      <div className="relative z-10 flex flex-col items-center gap-3 text-center">
        <div className="w-12 h-12 rounded-full border-2 border-blue-400/30 flex items-center justify-center">
          <div className="w-3 h-3 rounded-full bg-blue-500 animate-ping" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Loading Transit Map...</p>
      </div>
    </div>
  );
}

/**
 * Module Error Fallback with Retry (Stage E — Isolated Errors)
 */
export function ModuleErrorFallback({
  title = "Failed to load section",
  error,
  onRetry,
}: {
  title?: string;
  error?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="w-full rounded-2xl border border-rose-500/20 bg-rose-950/10 p-5 backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-4">
      <div className="space-y-1 text-center sm:text-left">
        <p className="text-sm font-semibold text-rose-300">{title}</p>
        <p className="text-xs text-rose-200/70">{error || "A temporary network error occurred."}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-semibold border border-rose-500/30 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * Next.js 16 Default Loading Export
 * Automatic Suspense fallback for App Router route navigations.
 */
export default function Loading() {
  return (
    <PremiumPageLoader
      message="Loading..."
      subMessage="Fetching latest transit telemetry..."
    />
  );
}
