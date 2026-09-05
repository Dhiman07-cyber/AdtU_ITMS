import React from 'react';
import Link from 'next/link';

/**
 * Next.js 16 Not Found (404) Boundary Page
 * Rendered when notFound() is invoked or route does not match.
 */
export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 shadow-xl text-center space-y-6">
        <div className="w-16 h-16 bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center mx-auto text-3xl font-black">
          404
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Page Not Found</h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            The resource or page you requested could not be found or may have moved.
          </p>
        </div>
        <Link
          href="/"
          className="inline-block w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-indigo-500/20 text-sm"
        >
          Return to Dashboard / Home
        </Link>
      </div>
    </div>
  );
}
