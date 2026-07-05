"use client";

import React, { useState, useEffect } from 'react';

export default function MobileInitialSplash() {
  const [visible, setVisible] = useState(true);
  const [displayText, setDisplayText] = useState('');
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    // Dismiss initial splash after initial page load settles
    const dismissTimer = setTimeout(() => {
      setVisible(false);
    }, 1200);

    return () => clearTimeout(dismissTimer);
  }, []);

  useEffect(() => {
    if (!visible) return;
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
  }, [displayText, isDeleting, phraseIndex, visible]);

  if (!visible) return null;

  return (
    <div
      id="mobile-app-splash"
      className="md:hidden fixed inset-0 z-[999999] bg-[#05060e] flex flex-col items-center justify-center p-6 text-white overflow-hidden transition-opacity duration-300 pointer-events-none"
      suppressHydrationWarning
    >
      <div className="flex flex-col items-center gap-6 max-w-[280px] w-full text-center">
        <div>
          <img
            src="/adtu-new-logo.svg"
            alt="AdtU Logo"
            className="w-36 h-auto object-contain"
          />
        </div>

        {/* Normal Spinner with Lightweight Animation */}
        <div className="w-8 h-8 rounded-full border-3 border-slate-800 border-t-indigo-500 animate-spin" />

        <div className="h-5 flex items-center justify-center">
          <span
            id="mobile-splash-typewriter"
            className="text-xs font-semibold text-slate-400 tracking-wider font-mono flex items-center uppercase"
            suppressHydrationWarning
          >
            {displayText}
            <span className="inline-block w-[1.5px] h-3 ml-1 bg-slate-400 animate-pulse" />
          </span>
        </div>
      </div>
    </div>
  );
}
