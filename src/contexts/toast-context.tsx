"use client";

import Toast from '@/components/toast';
import { createRandomId } from '@/lib/security/random-id';
import { createContext,ReactNode,useCallback,useContext,useMemo,useState } from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  addToast: (message: string, type: ToastType) => void;
  showToast: (message: string, type: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Stable identities: addToast is referenced in the dependency arrays of many effects
  // (e.g. the student tracking page's realtime trip-status subscriptions). Without
  // memoization, every toast caused ToastProvider to re-render and hand out a NEW
  // addToast, which tore down + recreated those Supabase channels — risking a brief
  // gap in bus visibility / trip updates. useCallback + useMemo keep the value stable.
  const addToast = useCallback((message: string, type: ToastType) => {
    const id = createRandomId();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const contextValue = useMemo(
    () => ({ addToast, showToast: addToast }),
    [addToast]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          id={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={removeToast}
        />
      ))}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
