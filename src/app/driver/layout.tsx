"use client";

import DriverLayout from "@/components/DriverLayout";
import { PermissionDeniedCard } from '@/components/PermissionDeniedCard';
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

  if (userData.status && userData.status !== 'active') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <PermissionDeniedCard
          title="Driver Access Suspended"
          description="Your driver account access has been temporarily deactivated or suspended by an administrator. Please contact the transport office."
          actionName="Driver Portal Access"
          showGoBack={false}
        />
      </div>
    );
  }

  return <DriverLayout>{children}</DriverLayout>;
}
