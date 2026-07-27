"use client";

import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

interface StudentAuthWrapperProps {
  children: React.ReactNode;
}

/**
 * Wrapper component that ensures user is a student
 * NO LONGER blocks access for expired students - they can access dashboard
 * Expiry check is now only on Track Bus page
 */
export default function StudentAuthWrapper({ children }: StudentAuthWrapperProps) {
  const { userData, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // If not a student, redirect to appropriate dashboard
    if (!loading && userData && userData.role !== 'student') {
      router.push(`/${userData.role}`);
    }
  }, [userData, loading, router]);

  // Loading state
  if (loading) {
    return null; // Auth context will handle its own loading, then dashboard will show its loader
  }

  // Not authenticated
  if (!userData) {
    return null; // Auth context will handle redirect
  }

  // Show content regardless of expiry status
  return <>{children}</>;
}
