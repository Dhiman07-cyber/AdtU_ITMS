import { auth } from '@/lib/firebase';
import {
  signOut,
  User as FirebaseUser,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { User, Student, Driver, Moderator } from '@/lib/types';
import { getUserById, getUserByEmail, updateUser } from '@/domains/identity';

// Export types from the new types file
export type { User, Student, Driver, Moderator } from '@/lib/types';
export type UserRole = 'admin' | 'moderator' | 'driver' | 'student';

// Function to sign in a user with Google
export async function signInWithGoogle() {
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    // Look up user in PostgreSQL via Identity domain
    let userData = await getUserById(user.uid);

    // Fallback to email search if UID not found (for pre-created accounts)
    if (!userData && user.email) {
      userData = await getUserByEmail(user.email);
    }

    // If user found, update lastLoginAt and return success
    if (userData) {
      await updateUser(user.uid, {
        lastLoginAt: new Date().toISOString()
      });
      return { success: true, user };
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
        console.error('Response status:', response.status);
        console.error('Response headers:', Object.fromEntries(response.headers.entries()));
      }
    } catch (unauthError: any) {
      // Log but don't fail - user can still proceed to application
      console.error('❌ Could not create unauthUser entry:', unauthError);
      console.error('Error details:', {
        name: unauthError?.name,
        message: unauthError?.message,
        stack: unauthError?.stack
      });
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
      // User closed the popup without signing in - this is normal behavior
      return { success: false, error: 'Sign in was cancelled' };
    } else if (error.code === 'auth/cancelled-popup-request') {
      // Another popup request cancelled this one - this can be ignored
      return { success: false, error: 'Sign in was cancelled' };
    } else if (error.code === 'auth/popup-blocked') {
      // Popup was blocked by the browser
      console.warn('⚠️ Sign-in popup was blocked by browser');
      return { success: false, error: 'Popup was blocked. Please allow popups for this site and try again.' };
    } else if (error.code === 'auth/network-request-failed') {
      // Network error
      console.warn('⚠️ Network error during sign-in');
      return { success: false, error: 'Network error. Please check your connection and try again.' };
    }

    // For all other errors, return the error message
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