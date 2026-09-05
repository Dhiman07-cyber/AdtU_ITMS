/**
 * OptimizedOTPInput - React 19 / Next.js 16 Component
 * High-performance OTP input leveraging React Compiler automatic memoization.
 */

"use client";

import { cn } from '@/lib/utils';
import React, { useEffect, useRef, useState } from 'react';

interface OptimizedOTPInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onComplete?: (value: string) => void;
}

export function OptimizedOTPInput({
  length = 6,
  value: externalValue,
  onChange,
  disabled = false,
  onComplete,
}: OptimizedOTPInputProps) {
  const [internalValue, setInternalValue] = useState(externalValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external value changes
  useEffect(() => {
    setInternalValue(externalValue);
  }, [externalValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    
    const newValue = e.target.value.replace(/[^0-9]/g, '').slice(0, length);
    setInternalValue(newValue);
    
    if (newValue.length === length) {
      setTimeout(() => {
        inputRef.current?.blur();
      }, 0);
    }
  };

  const handleBlur = () => {
    if (internalValue !== externalValue) {
      onChange(internalValue);
      
      if (onComplete && internalValue.length === length) {
        onComplete(internalValue);
      }
    }
  };

  return (
    <div className="relative w-full cursor-text" onClick={() => inputRef.current?.focus()}>
      <input
        ref={inputRef}
        type="text"
        value={internalValue}
        onChange={handleChange}
        onBlur={handleBlur}
        disabled={disabled}
        className="absolute inset-0 w-full h-full opacity-0 z-10 font-mono text-transparent bg-transparent border-0 appearance-none focus:outline-none"
        maxLength={length}
        inputMode="numeric"
        autoComplete="one-time-code"
      />
      <div className="flex gap-2.5 w-full justify-between">
        {Array.from({ length }).map((_, index) => (
          <div
            key={index}
            className={cn(
              "flex-1 aspect-[1/1.2] rounded-xl border flex items-center justify-center text-2xl font-mono",
              internalValue[index]
                ? "border-green-500/40 bg-green-500/5 text-green-400 shadow-[0_0_20px_-5px_rgba(34,197,94,0.3)]"
                : "border-gray-800 bg-[#0f1118]",
              !internalValue[index] && index === internalValue.length && !disabled
                ? "border-yellow-500/50 ring-1 ring-yellow-500/20 scale-105 z-10"
                : "",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            {internalValue[index] || (
              <div className="w-1.5 h-1.5 rounded-full bg-gray-700 md:w-2 md:h-2" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
