import { auth } from '@/lib/firebase';
import {
	GoogleAuthProvider,
	signInWithPopup,
	signOut
} from 'firebase/auth';

// Export types from the new types file
export type { Driver,Moderator,Student,User } from '@/lib/types';
export type UserRole = 'admin' | 'moderator' | 'driver' | 'student';

// Function to sign in a user with Google (client-safe)
export async function signInWithGoogle() {
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    // Look up user in PostgreSQL via secure API endpoint (client-safe)
    let userData: any = null;
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/auth/user', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const json = await response.json();
        if (json.exists && json.user) {
          userData = json.user;
        }
      }
    } catch (apiError) {
      console.warn('⚠️ Could not check user status via API:', apiError);
    }

    // If user found in PostgreSQL, return success
    if (userData) {
      return { success: true, user, userData };
    }

    // User not found in PostgreSQL - create unauthUser entry for tracking
    try {
      const token = await user.getIdToken();

      const response = await fetch('/api/unauth-users/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ Failed to create unauthUser entry:', errorData);
      }
    } catch (unauthError: any) {
      console.error('❌ Could not create unauthUser entry:', unauthError);
    }

    // Indicate that the user needs to apply for service
    return { success: true, user, needsApplication: true };
  } catch (error: any) {
    // List of error codes that are expected user behavior (not actual errors)
    const expectedUserCancellations = [
      'auth/popup-closed-by-user',
      'auth/cancelled-popup-request',
      'auth/popup-blocked'
    ];

    // Only log unexpected errors (exclude permission errors and user cancellations)
    if (!error.message?.includes('permission') &&
      error.code !== 'permission-denied' &&
      !expectedUserCancellations.includes(error.code)) {
      console.error('Error signing in with Google:', error);
    }

    // Handle specific Firebase errors
    if (error.code === 'auth/popup-closed-by-user') {
      return { success: false, error: 'Sign in was cancelled' };
    } else if (error.code === 'auth/cancelled-popup-request') {
      return { success: false, error: 'Sign in was cancelled' };
    } else if (error.code === 'auth/popup-blocked') {
      console.warn('⚠️ Sign-in popup was blocked by browser');
      return { success: false, error: 'Popup was blocked. Please allow popups for this site and try again.' };
    } else if (error.code === 'auth/network-request-failed') {
      console.warn('⚠️ Network error during sign-in');
      return { success: false, error: 'Network error. Please check your connection and try again.' };
    }

    return { success: false, error: error.message || 'An error occurred during sign in' };
  }
}

// Function to sign in a user (Google-only)
export async function signInUser() {
  return signInWithGoogle();
}

// Function to sign out a user
export async function signOutUser() {
  try {
    await signOut(auth);
    return { success: true };
  } catch (error) {
    console.error('Error signing out:', error);
    return { success: false, error: (error as Error).message };
  }
}