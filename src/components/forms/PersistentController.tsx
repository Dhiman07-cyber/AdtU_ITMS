/**
 * PersistentController - Wrapper for Radix UI / shadcn components
 * 
 * CRITICAL: Uses Controller - for components that need controlled behavior
 */

"use client";

import { Label } from '@/components/ui/label';
import { ReactElement } from 'react';
import { Control,Controller,FieldPath,FieldValues } from 'react-hook-form';

interface PersistentControllerProps<T extends FieldValues> {
  name: FieldPath<T>;
  control: Control<T>;
  label?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  render: (field: {
    value: any;
    onChange: (value: any) => void;
    onBlur: () => void;
  }) => ReactElement;
}

export function PersistentController<T extends FieldValues>({
  name,
  control,
  label,
  required,
  error,
  hint,
  render,
}: PersistentControllerProps<T>) {
  return (
    <div className="space-y-1">
      {label && (
        <Label htmlFor={name} className="text-sm font-medium">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </Label>
      )}
      
      <Controller
        name={name}
        control={control}
        render={({ field }) => render(field)}
      />
      
      {hint && !error && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      
      {error && (
        <p 
          id={`${name}-error`}
          className="text-xs text-red-500 font-medium"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
