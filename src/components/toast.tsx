"use client";

import { cn } from "@/lib/utils";
import { AlertCircle,AlertTriangle,CheckCircle,Info,X } from 'lucide-react';
import { useEffect,useState } from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  id: string;
  message: string;
  type: ToastType;
  onClose: (id: string) => void;
}

const Toast = ({ id, message, type, onClose }: ToastProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  useEffect(() => {
    // Small delay to allow animation to trigger
    const enterTimer = setTimeout(() => setIsVisible(true), 10);

    const timer = setTimeout(() => {
      handleClose();
    }, 5000);

    return () => {
      clearTimeout(enterTimer);
      clearTimeout(timer);
    };
  }, [id]);

  const handleClose = () => {
    setIsVisible(false);
    setIsRemoving(true);
    setTimeout(() => onClose(id), 300); // Wait for exit animation
  };

  const getTypeStyles = () => {
    switch (type) {
      case 'success':
        return 'bg-emerald-50/90 dark:bg-emerald-950/90 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200';
      case 'error':
        return 'bg-rose-50/90 dark:bg-rose-950/90 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200';
      case 'warning':
        return 'bg-amber-50/90 dark:bg-amber-950/90 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200';
      case 'info':
        return 'bg-blue-50/90 dark:bg-blue-950/90 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200';
      default:
        return 'bg-gray-50/90 dark:bg-gray-950/90 border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'success': return <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />;
      case 'error': return <AlertCircle className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0" />;
      case 'warning': return <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />;
      case 'info': return <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />;
      default: return <Info className="h-5 w-5 text-gray-600 dark:text-gray-400 shrink-0" />;
    }
  };

  return (
    <div
      className={cn(
        "fixed z-[99999] transition-all duration-500 ease-out",
        // Mobile: centered at bottom or top with margin
        "left-4 right-4 top-4 md:left-auto md:right-6 md:top-6 md:w-auto md:max-w-sm",
        isVisible && !isRemoving ? "translate-y-0 opacity-100 scale-100" : "-translate-y-4 opacity-0 scale-95"
      )}
    >
      <div
        className={cn(
          "flex items-start gap-3 p-4 rounded-xl shadow-lg backdrop-blur-md border",
          "hover:shadow-xl transition-shadow duration-300",
          getTypeStyles()
        )}
      >
        <div className="mt-0.5 animate-in zoom-in duration-300">
          {getIcon()}
        </div>

        <div className="flex-1 mr-2">
          <p className="text-sm font-medium leading-relaxed break-words">
            {message}
          </p>
        </div>

        <button
          onClick={handleClose}
          className="shrink-0 p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors"
        >
          <X className="h-4 w-4 opacity-60 hover:opacity-100" />
        </button>
      </div>
    </div>
  );
};

export default Toast;