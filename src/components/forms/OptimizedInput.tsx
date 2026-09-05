/**
 * OptimizedInput - React 19 / Next.js 16 Component
 * Leverages React Compiler automatic memoization for smooth typing & state synchronization.
 */

"use client";

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import React, { useEffect, useState } from 'react';

interface OptimizedInputProps {
  id: string;
  label?: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
  transform?: (value: string) => string;
}

export function OptimizedInput({
  id,
  label,
  type = 'text',
  value: externalValue,
  onChange,
  placeholder,
  required,
  disabled,
  className,
  labelClassName,
  transform,
}: OptimizedInputProps) {
  const [internalValue, setInternalValue] = useState(externalValue);

  // Sync external value changes
  useEffect(() => {
    setInternalValue(externalValue);
  }, [externalValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let newValue = e.target.value;
    if (transform) {
      newValue = transform(newValue);
    }
    setInternalValue(newValue);
  };

  const handleBlur = () => {
    if (internalValue !== externalValue) {
      onChange(internalValue);
    }
  };

  return (
    <div>
      {label && (
        <Label
          htmlFor={id}
          className={labelClassName || "block text-xs font-medium text-gray-700 dark:text-gray-300 mb-0.5"}
        >
          {label} {required && <span className="text-red-500">*</span>}
        </Label>
      )}
      <Input
        type={type}
        id={id}
        value={internalValue}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className={className || "text-xs h-9"}
      />
    </div>
  );
}
