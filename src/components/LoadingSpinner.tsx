/**
 * Universal Loading Components
 * Consistent loading experience across the app
 */

import React, { useState, useEffect } from 'react';

/**
 * Mobile Typewriter Loader
 * Displayed on mobile screens with centered logo, normal spinner, and typewriter text
 */
export function MobileTypewriterLoader({ className = "", fullScreen = true }: { className?: string; fullScreen?: boolean }) {
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
    <div className={`flex flex-col items-center justify-center w-full p-6 relative z-50 ${fullScreen ? 'fixed inset-0 bg-[#05060e] min-h-dvh' : 'min-h-[250px]'} ${className}`}>
      <div className="flex flex-col items-center gap-6 max-w-[280px] w-full text-center">
        <div>
          <img
            src="/adtu-new-logo.svg"
            alt="AdtU Logo"
            className="w-36 h-auto object-contain"
          />
        </div>

        {/* Normal Spinner with Lightweight Animation */}
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
 * Use for main page loads and heavy operations
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
 * Use inside buttons during operations
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
 * Use while fetching table data
 */
export function TableLoader({ rows = 5, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <div
              key={colIndex}
              className="h-12 bg-gray-200 dark:bg-gray-800 rounded animate-pulse flex-1"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Card Loading Skeleton
 * Use for dashboard cards
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
 * Use for small inline loading states
 */
export function MiniLoader({ className = "" }: { className?: string }) {
  return <div className={`w-4 h-4 border-2 border-gray-300 dark:border-gray-600 rounded-full animate-spin border-t-blue-600 ${className}`}></div>;
}

/**
 * Page Content Loader
 * Use for content areas
 */
export function PageLoader({ message = "Please wait..." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[75vh] md:min-h-[calc(100vh-220px)] flex-grow gap-3 sm:gap-4 w-full">
      <div className="relative">
        <div className="w-10 h-10 sm:w-12 sm:h-12 border-3 sm:border-4 border-gray-200 dark:border-gray-700 rounded-full animate-spin border-t-blue-600"></div>
      </div>
      <p className="text-base sm:text-lg font-medium text-gray-700 dark:text-gray-300">{message}</p>
    </div>
  );
}

/**
 * Premium Page Content Loader
 */
export function PremiumPageLoader({
  message = "Loading experience...",
  subMessage = "Optimizing your dashboard...",
  noWrapper = false,
  fullScreen = false,
  className = ""
}: {
  message?: string;
  subMessage?: string;
  noWrapper?: boolean;
  fullScreen?: boolean;
  className?: string;
}) {
  const content = (
    <div className="flex flex-col items-center gap-3.5 text-center">
      <div className="relative scale-110 sm:scale-125">
        {/* Ambient Glows */}
        <div className="absolute -inset-10 bg-purple-500/15 blur-[40px] animate-pulse rounded-full" />
        <div className="absolute -inset-10 bg-blue-500/10 blur-[30px] animate-pulse delay-700 rounded-full" />

        {/* Main Spinner Container */}
        <div className="relative z-10">
          <div className="pink-purple-spinner bg-dark-blue shadow-2xl shadow-purple-500/30"></div>
          {/* Inner pulse ring */}
          <div className="absolute inset-0 border border-white/5 rounded-full scale-150 opacity-20 animate-ping" />
        </div>
      </div>

      <div className="space-y-2.5 z-10 w-full max-w-xl mt-1 px-4">
        <h3 className="text-base sm:text-lg md:text-xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-pink-400 bg-clip-text text-transparent animate-pulse tracking-tight leading-tight sm:whitespace-nowrap">
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
    <div className={`flex flex-col items-center justify-center w-full p-6 text-center relative overflow-hidden ${fullScreen ? 'fixed inset-0 min-h-dvh bg-slate-950/80 backdrop-blur-sm z-50' : 'min-h-[75vh] md:min-h-[calc(100vh-220px)] flex-grow'} ${className}`}>
      <div className="w-full flex flex-col items-center gap-5 mt-[-10dvh] relative z-10">
        {content}
      </div>
    </div>
  );
}
