/**
 * OptimizedTextarea - Prevents parent re-renders during typing
 * Uses internal state for immediate feedback, syncs to parent on blur
 */

"use client";

import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { memo,useCallback,useEffect,useState } from 'react';

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

export const OptimizedTextarea = memo(function OptimizedTextarea({
  id,
  label,
  value: externalValue,
  onChange,
  placeholder,
  required,
  disabled,
  className,
  rows = 3
}: OptimizedTextareaProps) {
  const [internalValue, setInternalValue] = useState(externalValue);

  // Sync external value changes (e.g., from hydration)
  useEffect(() => {
    setInternalValue(externalValue);
  }, [externalValue]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInternalValue(e.target.value);
  }, []);

  const handleBlur = useCallback(() => {
    // Only call onChange if value actually changed
    if (internalValue !== externalValue) {
      onChange(internalValue);
    }
  }, [internalValue, externalValue, onChange]);

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
});
