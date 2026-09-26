"use client";

import StudentAccessBlockScreen from '@/components/StudentAccessBlockScreen';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

interface StudentAuthWrapperProps {
  children: React.ReactNode;
}

/**
 * Wrapper component that ensures user is an authenticated student.
 * If admin has revoked or suspended access, all screens (dashboard, pass, profile, etc.) are blocked.
 */
export default function StudentAuthWrapper({ children }: StudentAuthWrapperProps) {
  const { userData, loading, signOut } = useAuth();
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

  // Check if admin has revoked/suspended access
  const isRevoked =
    userData.role === 'student' &&
    userData.status &&
    ['suspended', 'inactive', 'revoked'].includes(userData.status);

  if (isRevoked) {
    return (
      <StudentAccessBlockScreen
        validUntil={(userData as any)?.validUntil ?? null}
        studentName={(userData as any)?.fullName || (userData as any)?.name || 'Student'}
        reason="inactive_status"
        onLogout={signOut}
        deadlineConfig={null}
      />
    );
  }

  return <>{children}</>;
}
