'use client';

import React from 'react';

/**
 * Next.js 16 Global Error Boundary
 * Replaces the root layout when an unhandled error occurs at the root level.
 * Must define its own <html> and <body> tags.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-900 text-white min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 text-red-400 rounded-full flex items-center justify-center mx-auto text-2xl">
            ⚠️
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">Critical Application Error</h1>
            <p className="text-slate-400 text-sm">
              An unexpected system error occurred. Our engineering telemetry has logged this incident.
            </p>
            {error.digest && (
              <p className="text-xs font-mono bg-slate-900/60 text-slate-500 p-2 rounded mt-3 border border-slate-700/50">
                Digest: {error.digest}
              </p>
            )}
          </div>
          <button
            onClick={() => reset()}
            className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-medium rounded-xl transition-all shadow-lg shadow-indigo-500/20"
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
