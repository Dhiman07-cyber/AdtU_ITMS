'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';

/**
 * Next.js 16 Route Segment Error Boundary
 * Automatically handles unexpected errors within page segments.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to client telemetry or service worker
    console.error('App Segment Error:', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 shadow-xl text-center space-y-6">
        <div className="w-14 h-14 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-full flex items-center justify-center mx-auto text-2xl">
          ⚡
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Something went wrong</h2>
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            We encountered an unexpected error while processing this page.
          </p>
          {error.digest && (
            <p className="text-xs font-mono bg-slate-100 dark:bg-slate-800 text-slate-500 p-2 rounded mt-3 border border-slate-200 dark:border-slate-700">
              Digest: {error.digest}
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => reset()}
            className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-medium rounded-xl transition-all shadow-md text-sm"
          >
            Retry
          </button>
          <Link
            href="/"
            className="flex-1 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium rounded-xl transition-all text-sm flex items-center justify-center"
          >
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
}
