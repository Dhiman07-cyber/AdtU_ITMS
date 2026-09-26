"use client";

import { PermissionDeniedCard } from '@/components/PermissionDeniedCard';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect,useState } from 'react';

export default function ModeratorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { currentUser, userData, loading } = useAuth();
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Wait for auth to fully load
    if (loading) return;

    // Only redirect if auth is finished and we're sure there's no user
    // Added a small delay to handle hydration settle-down
    const timeout = setTimeout(() => {
      if (!currentUser) {
        console.log('ModeratorLayout: No user, redirecting to login');
        // Save current path to return to after login
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('returnUrl', window.location.pathname);
        }
        router.push('/login');
        return;
      }

      // Role check logic - Allow BOTH admin and moderator
      if (userData) {
        const isAuthorized = userData.role === 'moderator' || userData.role === 'admin';

        if (!isAuthorized) {
          console.log(`ModeratorLayout: User is ${userData.role}, redirecting to their dashboard`);
          router.push(`/${userData.role}`);
          return;
        }

        // All checks passed
        setIsReady(true);
      }
    }, 200);

    return () => clearTimeout(timeout);
  }, [currentUser, userData, loading, router]);

  // Avoid showing double-loaders by returning null here. 
  // The specific page components (like the Dashboard) will display their own tailored LoadingSpinners.
  if (loading || (!isReady && currentUser && !userData)) {
    return null;
  }

  // Final gate - Allow both admin and moderator
  const isAuthorized = userData?.role === 'admin' || userData?.role === 'moderator';
  if (!currentUser || !isAuthorized) {
    return null;
  }

  // Suspended or inactive moderator check - completely block access
  if (userData.role === 'moderator' && userData.status && userData.status !== 'active') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <PermissionDeniedCard
          title="Moderator Access Suspended"
          description="Your moderator account access has been temporarily revoked or suspended by an administrator. Please contact your system administrator for assistance."
          actionName="Moderator Portal Access"
          showGoBack={false}
        />
      </div>
    );
  }

  return <>{children}</>;
}
