import React from 'react';
import Link from 'next/link';

/**
 * Next.js 16 Forbidden Boundary Page (403)
 * Triggered automatically when forbidden() is invoked in server code.
 */
export default function Forbidden() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 shadow-xl text-center space-y-6">
        <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 text-red-500 rounded-full flex items-center justify-center mx-auto text-3xl font-black">
          403
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Access Forbidden</h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            You do not have the required role or administrative permissions to access this route.
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/"
            className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-indigo-500/20 text-sm flex items-center justify-center"
          >
            Return Home
          </Link>
          <Link
            href="/login"
            className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium rounded-xl transition-all text-sm flex items-center justify-center"
          >
            Switch Account
          </Link>
        </div>
      </div>
    </div>
  );
}
