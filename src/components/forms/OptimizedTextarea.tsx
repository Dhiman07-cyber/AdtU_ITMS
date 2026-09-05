/**
 * OptimizedTextarea - React 19 / Next.js 16 Component
 * Leverages React Compiler automatic memoization for smooth typing & state synchronization.
 */

"use client";

import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import React, { useEffect, useState } from 'react';

interface OptimizedTextareaProps {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  rows?: number;
}

export function OptimizedTextarea({
  id,
  label,
  value: externalValue,
  onChange,
  placeholder,
  required,
  disabled,
  className,
  rows = 3,
}: OptimizedTextareaProps) {
  const [internalValue, setInternalValue] = useState(externalValue);

  // Sync external value changes
  useEffect(() => {
    setInternalValue(externalValue);
  }, [externalValue]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInternalValue(e.target.value);
  };

  const handleBlur = () => {
    if (internalValue !== externalValue) {
      onChange(internalValue);
    }
  };

  return (
    <div>
      {label && (
        <Label htmlFor={id} className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-0.5">
          {label} {required && <span>*</span>}
        </Label>
      )}
      <Textarea
        id={id}
        value={internalValue}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        rows={rows}
        className={className || "resize-none text-xs"}
      />
    </div>
  );
}
