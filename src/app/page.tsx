'use client';

import LandingPage from '@/app/(landing)/page';
import { PremiumPageLoader } from '@/components/LoadingSpinner';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect,useState } from 'react';

export default function Home() {
  const { currentUser, userData, loading, needsApplication } = useAuth();
  const router = useRouter();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [redirectFailed, setRedirectFailed] = useState(false);

  useEffect(() => {
    // Don't do anything while still loading
    if (loading) {
      return;
    }

    // If no user, show landing page (handled in render)
    if (!currentUser) {
      setIsRedirecting(false);
      return;
    }

    // User is logged in - determine where to redirect
    if (userData && userData.role) {
      // User has valid data with role - redirect to their dashboard
      setIsRedirecting(true);
      const redirectPath = `/${userData.role}`;
      console.log(`🔄 Redirecting to ${redirectPath}`);
      router.push(redirectPath);
    } else if (needsApplication) {
      // User needs to apply for service
      setIsRedirecting(true);
      console.log('🔄 Redirecting new user to application form');
      router.push('/apply/form');
    } else {
      // User is logged in but no userData and doesn't need application
      // This could be a transient state - wait a bit, then show landing
      console.log('⚠️ User logged in but no userData yet, waiting...');

      // Set a timeout to prevent infinite waiting
      const timeout = setTimeout(() => {
        console.log('⚠️ Timeout waiting for userData, showing landing page');
        setRedirectFailed(true);
        setIsRedirecting(false);
      }, 5000); // 5 second timeout

      return () => clearTimeout(timeout);
    }
  }, [loading, currentUser, userData, needsApplication, router]);

  // Show loading spinner only while checking auth
  if (loading) {
    return <PremiumPageLoader message="Loading..." fullScreen />;
  }

  // Show redirecting state only when we're actually redirecting
  if (isRedirecting && !redirectFailed) {
    return <PremiumPageLoader message={needsApplication ? 'Redirecting to application...' : 'Redirecting...'} fullScreen />;
  }

  // Show landing page for:
  // 1. Non-logged in users
  // 2. Users where redirect failed/timed out
  // 3. Any other fallback case
  return <LandingPage />;
}
