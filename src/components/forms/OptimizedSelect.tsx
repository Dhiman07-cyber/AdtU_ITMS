/**
 * OptimizedSelect - React 19 / Next.js 16 Component
 * Leverages React Compiler automatic memoization.
 */

"use client";

import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';
import React, { ReactNode, useEffect, useState } from 'react';

interface OptimizedSelectProps {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
  labelClassName?: string;
  disabled?: boolean;
  children: ReactNode;
}

export function OptimizedSelect({
  id,
  label,
  value: externalValue,
  onChange,
  placeholder,
  required,
  className,
  labelClassName,
  disabled,
  children,
}: OptimizedSelectProps) {
  const [internalValue, setInternalValue] = useState(externalValue);

  // Sync external value changes
  useEffect(() => {
    setInternalValue(externalValue);
  }, [externalValue]);

  const handleValueChange = (newValue: string) => {
    setInternalValue(newValue);
    onChange(newValue);
  };

  return (
    <div>
      {label && (
        <Label htmlFor={id} className={labelClassName || "block text-xs font-medium text-gray-700 dark:text-gray-300 mb-0.5"}>
          {label} {required && <span className="text-red-500">*</span>}
        </Label>
      )}
      <Select
        value={internalValue}
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SelectTrigger className={className || "text-xs h-9"} id={id}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {children}
        </SelectContent>
      </Select>
    </div>
  );
}
