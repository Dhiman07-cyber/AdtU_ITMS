/**
 * PersistentInput - Native input wrapper for React Hook Form
 * 
 * CRITICAL: Uses register() - NEVER use value/onChange props
 */

"use client";

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { forwardRef,InputHTMLAttributes } from 'react';
import { UseFormRegisterReturn } from 'react-hook-form';

interface PersistentInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'name'> {
  label?: string;
  error?: string;
  registration: UseFormRegisterReturn;
  required?: boolean;
  hint?: string;
}

export const PersistentInput = forwardRef<HTMLInputElement, PersistentInputProps>(
  ({ label, error, registration, required, hint, className, ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <Label htmlFor={registration.name} className="text-sm font-medium">
            {label}
            {required && <span className="text-red-500 ml-1">*</span>}
          </Label>
        )}
        
        <Input
          {...registration}
          {...props}
          ref={ref}
          id={registration.name}
          aria-invalid={!!error}
          aria-describedby={error ? `${registration.name}-error` : undefined}
          className={cn(
            error && "border-red-500 focus-visible:ring-red-500",
            className
          )}
        />
        
        {hint && !error && (
          <p className="text-xs text-muted-foreground">{hint}</p>
        )}
        
        {error && (
          <p 
            id={`${registration.name}-error`}
            className="text-xs text-red-500 font-medium"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    );
  }
);

PersistentInput.displayName = 'PersistentInput';
