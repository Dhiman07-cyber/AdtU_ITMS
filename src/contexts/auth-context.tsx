"use client";

import { auth } from '@/lib/firebase';
import { setSigningOut } from '@/lib/firestore-error-handler';
import { User, signInWithGoogle, getSafeIdToken } from '@/lib/user-service';
import { User as FirebaseUser,onAuthStateChanged } from 'firebase/auth';
import { ReactNode,createContext,useCallback,useContext,useEffect,useMemo,useRef,useState } from 'react';

interface AuthContextType {
  currentUser: FirebaseUser | null;
  userData: User | null;
  loading: boolean;
  needsApplication: boolean;
  isExpired: boolean; // Derived from validUntil - no Firestore writes!
  signInWithGoogle: () => Promise<{ success: boolean; error?: string; user?: FirebaseUser; needsApplication?: boolean }>;
  signOut: () => Promise<{ success: boolean; error?: string }>;
  refreshUserData: () => Promise<void>;
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
 * FIX 87: Prevent false positives when validUntil is missing or user is non-student
 */
function checkIfExpired(userDataOrValidUntil: any): boolean {
  if (!userDataOrValidUntil) return false;

  // If user object passed
  if (typeof userDataOrValidUntil === 'object' && 'role' in userDataOrValidUntil) {
    if (userDataOrValidUntil.role && userDataOrValidUntil.role !== 'student') return false;
    const rawExpiry = userDataOrValidUntil.validUntil ?? userDataOrValidUntil.valid_until;
    if (!rawExpiry) return false;
    return checkDateExpired(rawExpiry);
  }

  // If validUntil timestamp passed directly
  return checkDateExpired(userDataOrValidUntil);
}

function checkDateExpired(validUntil: any): boolean {
  if (!validUntil) return false;

  try {
    let expiryDate: Date;
    if (validUntil?.toDate && typeof validUntil.toDate === 'function') {
      expiryDate = validUntil.toDate();
    } else if (validUntil?.seconds) {
      expiryDate = new Date(validUntil.seconds * 1000);
    } else if (validUntil instanceof Date) {
      expiryDate = validUntil;
    } else if (typeof validUntil === 'string') {
      expiryDate = new Date(validUntil);
    } else {
      return false;
    }

    if (isNaN(expiryDate.getTime())) return false;
    return expiryDate < new Date();
  } catch {
    return false;
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
          const token = await getSafeIdToken(user);
          const response = await fetch('/api/auth/user', {
            headers: { 'Authorization': `Bearer ${token}` },
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
            } else if (result.exists === false && !result.hasPendingApp) {
              // FIX 24: User confirmed non-existent in database — needs to apply
              setUserData(null);
              setCachedUserData(null);
              setNeedsApplication(true);
              setIsExpired(false);
              setLoading(false);
            } else {
              // Pending app exists or ambiguous exists flag
              setUserData(null);
              setNeedsApplication(false);
              setIsExpired(false);
              setLoading(false);
            }
          } else {
            // FIX 24: API error (e.g. 500, 502, 503, 429) — keep cached user, do NOT redirect to /apply
            if (cachedData && cachedData.uid === user.uid) {
              setUserData(cachedData);
            }
            setNeedsApplication(false);
            setLoading(false);
          }
        } catch (error: any) {
          if (!isMounted) return;

          // FIX 24: Network error — use cached data if available, do NOT redirect to /apply
          if (cachedData && cachedData.uid === user.uid) {
            setUserData(cachedData);
          }
          setNeedsApplication(false);
          setLoading(false);
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

  const refreshUserData = useCallback(async () => {
    if (!currentUser) return;
    try {
      const token = await getSafeIdToken(currentUser);
      const response = await fetch('/api/auth/user', {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (response.ok) {
        const result = await response.json();
        if (result.exists && result.user) {
          const data = result.user as User;
          setUserData(data);
          setCachedUserData(data);
          setNeedsApplication(false);
          if (data.role === 'student') {
            setIsExpired(checkIfExpired(data.validUntil));
          } else {
            setIsExpired(false);
          }
        }
      }
    } catch (err) {
      console.error('Failed to refresh user data:', err);
    }
  }, [currentUser]);

  const value = useMemo(() => ({
    currentUser,
    userData,
    loading,
    needsApplication,
    isExpired,
    signInWithGoogle: signInWithGoogleContext,
    signOut,
    refreshUserData
  }), [currentUser, userData, loading, needsApplication, isExpired, signInWithGoogleContext, signOut, refreshUserData]);

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