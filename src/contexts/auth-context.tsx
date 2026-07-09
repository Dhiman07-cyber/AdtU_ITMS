"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useRef, useMemo, useCallback } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { setSigningOut, getSigningOutState } from '@/lib/firestore-error-handler';
import { User, signInWithGoogle } from '@/lib/user-service';

interface AuthContextType {
  currentUser: FirebaseUser | null;
  userData: User | null;
  loading: boolean;
  needsApplication: boolean;
  isExpired: boolean; // Derived from validUntil - no Firestore writes!
  signInWithGoogle: () => Promise<{ success: boolean; error?: string; user?: FirebaseUser; needsApplication?: boolean }>;
  signOut: () => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Local storage keys
const CACHE_KEY = 'adtu_bus_user_data';
const CACHE_EXPIRY_KEY = 'adtu_bus_cache_expiry';

// Cache duration: 5 minutes - balanced for real-time updates while reducing Firestore reads
// Real-time listeners will still update immediately when data changes
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached user data from localStorage
 * Used for instant UI on page load; real-time listeners update afterwards
 */
function getCachedUserData(): User | null {
  try {
    if (typeof window === 'undefined') return null;

    const cached = localStorage.getItem(CACHE_KEY);
    const expiry = localStorage.getItem(CACHE_EXPIRY_KEY);

    if (!cached || !expiry) return null;

    // Check if cache is expired
    if (Date.now() > parseInt(expiry)) {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(CACHE_EXPIRY_KEY);
      return null;
    }

    return JSON.parse(cached);
  } catch (error) {

    return null;
  }
}

/**
 * Save user data to localStorage cache
 */
function setCachedUserData(data: User | null): void {
  try {
    if (data) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      localStorage.setItem(CACHE_EXPIRY_KEY, (Date.now() + CACHE_DURATION).toString());
    } else {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(CACHE_EXPIRY_KEY);
    }
  } catch (error) {

  }
}

/**
 * Check if service is expired based on validUntil
 * This is a FRONTEND-ONLY check - no Firestore writes!
 */
function checkIfExpired(validUntil: any): boolean {
  if (!validUntil) {

    return true;
  }

  try {

    let expiryDate: Date;

    // Handle Firestore Timestamp
    if (validUntil?.toDate && typeof validUntil.toDate === 'function') {
      expiryDate = validUntil.toDate();

    }
    // Handle Firebase Timestamp seconds/nanoseconds
    else if (validUntil?.seconds) {
      expiryDate = new Date(validUntil.seconds * 1000);

    }
    // Handle Date object
    else if (validUntil instanceof Date) {
      expiryDate = validUntil;

    }
    // Handle string
    else if (typeof validUntil === 'string') {
      expiryDate = new Date(validUntil);

    }
    else {

      return true;
    }

    const now = new Date();
    const isExpired = expiryDate < now;

    return isExpired;
  } catch (error) {

    return true;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userData, setUserData] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsApplication, setNeedsApplication] = useState(false);


  const [isExpired, setIsExpired] = useState(false);
  const signOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (signOutTimerRef.current) {
        clearTimeout(signOutTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!isMounted) return;


      setCurrentUser(user);

      if (user) {
        // Step 1: Try to load from cache first (INSTANT UI)
        const cachedData = getCachedUserData();
        if (cachedData && cachedData.uid === user.uid) {

          setUserData(cachedData);
          setNeedsApplication(false);
          // Only check expiration for students (they have validUntil field)
          if (cachedData.role === 'student') {
            setIsExpired(checkIfExpired(cachedData.validUntil));
          } else {
            // Non-student users (admin, moderator, driver) are never expired
            setIsExpired(false);
          }
          setLoading(false); // Show UI immediately with cached data
        }

        // Step 2: Fetch user data from PostgreSQL via API
        try {
          const response = await fetch('/api/auth/user', {
            headers: { 'Authorization': `Bearer ${await user.getIdToken()}` },
          });

          if (!isMounted) return;

          if (response.ok) {
            const result = await response.json();

            if (result.exists && result.user) {
              const data = result.user as User;

              // Update state and cache
              setUserData(data);
              setCachedUserData(data);
              setNeedsApplication(false);

              // Only check expiration for students (they have validUntil field)
              if (data.role === 'student') {
                setIsExpired(checkIfExpired(data.validUntil));
              } else {
                // Non-student users (admin, moderator, driver) are never expired
                setIsExpired(false);
              }
              setLoading(false);
            } else {
              // User not found in PostgreSQL — needs to apply
              setUserData(null);
              setCachedUserData(null);
              setNeedsApplication(true);
              setIsExpired(false);
              setLoading(false);
            }
          } else {
            // API error — treat as "needs to apply" for new users
            setUserData(null);
            setNeedsApplication(true);
            setIsExpired(false);
            setLoading(false);
          }
        } catch (error: any) {
          if (!isMounted) return;

          // Network error — use cached data if available
          if (cachedData && cachedData.uid === user.uid) {
            // Already set from cache above
            setLoading(false);
          } else {
            setUserData(null);
            setNeedsApplication(true);
            setIsExpired(false);
            setLoading(false);
          }
        }
      } else {
        // No user logged in
        if (currentUser) {
          setSigningOut(true);
          if (signOutTimerRef.current) clearTimeout(signOutTimerRef.current);
          signOutTimerRef.current = setTimeout(() => {
            setSigningOut(false);
            signOutTimerRef.current = null;
          }, 3000);
        }
        setUserData(null);
        setCachedUserData(null);
        setNeedsApplication(false);
        setIsExpired(false);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const signInWithGoogleContext = useCallback(async () => {
    try {
      const response = await signInWithGoogle();

      if (response.success && response.user) {
        // Check if user needs to apply for service
        if (response.needsApplication) {
          setNeedsApplication(true);
          return { success: true, user: response.user, needsApplication: true };
        }
        // For the first admin, they might not have a user document yet
        // We'll handle this in the calling component
        return { success: true, user: response.user };
      } else {
        // Don't treat "Sign in was cancelled" as an error that should be displayed to the user
        if (response.error === 'Sign in was cancelled') {
          // This is a normal user action, not an error - don't log it

          return { success: false };
        }
        return { success: false, error: response.error || 'Sign in failed' };
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      // Set flag to suppress permission errors during sign-out
      setSigningOut(true);

      // Clear state immediately to prevent any more operations
      setUserData(null);
      setNeedsApplication(false);
      setIsExpired(false);
      setCurrentUser(null);

      // Clear cache
      setCachedUserData(null);

      // Now sign out from Firebase
      try {
        const { signOutUser } = await import('@/lib/user-service');
        await signOutUser();
      } catch (signOutError) {
        // Even if Firebase signout fails, we've already cleared local state
      }

      // Reset the flag after a longer delay to allow any pending errors to be suppressed
      if (signOutTimerRef.current) clearTimeout(signOutTimerRef.current);
      signOutTimerRef.current = setTimeout(() => {
        setSigningOut(false);
        signOutTimerRef.current = null;
      }, 2000);

      return { success: true };
    } catch (error) {
      // Reset flag on error
      if (signOutTimerRef.current) clearTimeout(signOutTimerRef.current);
      signOutTimerRef.current = setTimeout(() => {
        setSigningOut(false);
        signOutTimerRef.current = null;
      }, 2000);
      return { success: false, error: (error as Error).message };
    }
  }, []);

  const value = useMemo(() => ({
    currentUser,
    userData,
    loading,
    needsApplication,
    isExpired,
    signInWithGoogle: signInWithGoogleContext,
    signOut
  }), [currentUser, userData, loading, needsApplication, isExpired, signInWithGoogleContext, signOut]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}