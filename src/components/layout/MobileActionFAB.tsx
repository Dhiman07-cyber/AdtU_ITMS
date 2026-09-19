"use client";

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Plus, X } from 'lucide-react';

export interface MobileFABAction {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  onClick?: () => void;
  color?: string;
  badge?: string;
}

interface MobileActionFABProps {
  actions: MobileFABAction[];
  ariaLabel?: string;
}

export function MobileActionFAB({ actions, ariaLabel = "Quick actions menu" }: MobileActionFABProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleActionClick = (action: MobileFABAction) => {
    setIsOpen(false);
    if (action.onClick) {
      action.onClick();
    } else if (action.href) {
      if (action.href.startsWith('http')) {
        window.location.href = action.href;
      } else {
        router.push(action.href);
      }
    }
  };

  if (!actions || actions.length === 0) return null;
  if (!mounted) return null;

  return createPortal(
    <div className="md:hidden">
      {/* Backdrop overlay when open */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-40 animate-in fade-in duration-200 pointer-events-auto"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Floating Container */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2.5 pointer-events-none">
        {/* Action Menu Popup */}
        {isOpen && (
          <div className="flex flex-col gap-2 mb-1 items-end animate-in fade-in slide-in-from-bottom-4 duration-200 pointer-events-auto">
            {actions.map((action, idx) => {
              const Icon = action.icon;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleActionClick(action)}
                  className="focus:outline-none w-full flex justify-end cursor-pointer pointer-events-auto"
                >
                  <div className="flex items-center gap-2.5 w-[215px] py-2 px-3 rounded-full bg-slate-900/95 border border-slate-700/80 shadow-2xl backdrop-blur-md text-white hover:bg-slate-800 transition-all active:scale-[0.98] cursor-pointer select-none">
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center shadow-md shrink-0",
                      action.color || "bg-blue-600 text-white"
                    )}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold whitespace-nowrap tracking-wide truncate text-left flex-1">{action.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Primary FAB Trigger Button */}
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label={ariaLabel}
          aria-expanded={isOpen}
          className={cn(
            "w-[52px] h-[52px] rounded-full flex items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-all duration-200 active:scale-[0.98] focus:outline-none cursor-pointer pointer-events-auto",
            isOpen
              ? "bg-rose-600 text-white rotate-90 shadow-rose-600/30"
              : "bg-blue-600 text-white hover:bg-blue-500 shadow-blue-600/30 ring-2 ring-white/20"
          )}
        >
          {isOpen ? (
            <X className="w-6 h-6 transition-transform duration-200" />
          ) : (
            <Plus className="w-6 h-6 transition-transform duration-200" />
          )}
        </button>
      </div>
    </div>,
    document.body
  );
}
