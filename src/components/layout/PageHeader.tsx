"use client";

import React from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
  actionsClassName?: string;
}

/**
 * PageHeader:
 * Container-query powered, space-aware header layout for ITMS admin/moderator/student pages.
 * 
 * Invariants:
 * - Desktop/Wide Container: Title on left, actions in a single crisp row on the right.
 * - Narrow/Compact Container: Deliberate, clean transition to stacked title + cohesive action bar.
 *   Prevents accidental, ugly orphaned button wrapping (e.g. 1 button falling to line 2 while 4 stay on line 1).
 * - Touch Target Safety: Preserves accessible minimum targets and accessibility labels.
 */
export default function PageHeader({
  title,
  subtitle,
  actions,
  badge,
  className,
  actionsClassName,
}: PageHeaderProps) {
  return (
    <div className={cn("itms-page-header-container mb-6", className)}>
      <header className="itms-page-header">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            {typeof title === 'string' ? (
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground truncate">
                {title}
              </h1>
            ) : (
              title
            )}
            {badge}
          </div>
          {subtitle && (
            <p className="text-xs md:text-sm text-muted-foreground mt-1 leading-relaxed line-clamp-2">
              {subtitle}
            </p>
          )}
        </div>

        {actions && (
          <div
            className={cn("itms-page-header-actions", actionsClassName)}
            role="toolbar"
            aria-label="Page Actions"
          >
            {actions}
          </div>
        )}
      </header>
    </div>
  );
}
