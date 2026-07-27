/**
 * FormRoot - Standardized form wrapper with error handling
 * 
 * Provides:
 * - Form context
 * - Error boundary
 * - Loading states
 * - Accessibility
 */

"use client";

import { cn } from '@/lib/utils';
import { FormHTMLAttributes,ReactNode } from 'react';
import { FieldValues,FormProvider,UseFormReturn } from 'react-hook-form';

interface FormRootProps<T extends FieldValues> extends Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> {
  form: UseFormReturn<T>;
  onSubmit: (data: T) => void | Promise<void>;
  children: ReactNode;
  isSubmitting?: boolean;
  className?: string;
}

export function FormRoot<T extends FieldValues>({
  form,
  onSubmit,
  children,
  isSubmitting = false,
  className,
  ...props
}: FormRootProps<T>) {
  const handleSubmit = form.handleSubmit(async (data) => {
    try {
      await onSubmit(data);
    } catch (error) {
      console.error('[FormRoot] Submit error:', error);
      // Error handling is delegated to the parent
      throw error;
    }
  });

  return (
    <FormProvider {...form}>
      <form
        onSubmit={handleSubmit}
        noValidate
        className={cn('space-y-6', className)}
        {...props}
      >
        <fieldset disabled={isSubmitting} className="space-y-6">
          {children}
        </fieldset>
      </form>
    </FormProvider>
  );
}
