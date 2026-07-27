"use client";

import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { currentUser, userData, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Wait for auth to fully load
    if (loading) return;

    // Only redirect if auth is finished and we're sure there's no user
    // Added a small delay to handle hydration settle-down
    const timeout = setTimeout(() => {
      if (!currentUser) {
        console.log('AdminLayout: No user, redirecting to login');
        // Save current path to return to after login
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('returnUrl', window.location.pathname);
        }
        router.push('/login');
        return;
      }

      // Role check logic
      if (userData && userData.role !== 'admin') {
        console.log(`AdminLayout: User is ${userData.role}, redirecting to their dashboard`);
        router.push(`/${userData.role}`);
      }
    }, 200);

    return () => clearTimeout(timeout);
  }, [currentUser, userData, loading, router]);

  // Avoid showing double-loaders by returning null here. 
  // The specific page components (like the Dashboard) will display their own tailored LoadingSpinners.
  if (loading || (currentUser && !userData)) {
    return null;
  }

  // Final gate
  if (!currentUser || userData?.role !== 'admin') {
    return null;
  }

  return <>{children}</>;
}
