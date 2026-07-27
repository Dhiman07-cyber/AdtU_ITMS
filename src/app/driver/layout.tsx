"use client";

import DriverLayout from "@/components/DriverLayout";
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { currentUser, userData, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const timeout = setTimeout(() => {
      if (!currentUser) {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('returnUrl', window.location.pathname);
        }
        router.push('/login');
        return;
      }

      if (userData && userData.role !== 'driver') {
        router.push(`/${userData.role}`);
      }
    }, 200);

    return () => clearTimeout(timeout);
  }, [currentUser, userData, loading, router]);

  if (loading || (currentUser && !userData)) {
    return null;
  }

  if (!currentUser || userData?.role !== 'driver') {
    return null;
  }

  return <DriverLayout>{children}</DriverLayout>;
}
