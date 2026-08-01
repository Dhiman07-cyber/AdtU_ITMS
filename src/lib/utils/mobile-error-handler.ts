/**
 * Mobile Error Handler
 * Comprehensive error handling for mobile devices and PWA
 * 
 * Handles:
 * - Chunk loading failures (Failed to load chunk / _next/static/chunks...)
 * - Network errors when screen turns off/on
 * - Empty error details
 * - Firestore permission errors during signout
 * - Connection recovery on app foreground
 */

import { getSigningOutState } from '@/lib/firestore-error-handler';

let isInitialized = false;
let reconnectTimeoutId: NodeJS.Timeout | null = null;
let lastOnlineStatus = true;
let chunkFailureCount = 0;
const MAX_CHUNK_FAILURES_BEFORE_RELOAD = 3;

// Errors to suppress completely (don't log or store)
const SUPPRESSED_ERROR_PATTERNS = [
  'Missing or insufficient permissions',
  'permission-denied',
  'Failed to get document because the client is offline',
  'ResizeObserver loop',
  'ResizeObserver loop completed with undelivered notifications',
  'Non-Error promise rejection captured',
  'Network request failed',
  'Load failed',
  'net::ERR_',
  'Failed to fetch',
  'AbortError',
  'ERR_CACHE_OPERATION_NOT_SUPPORTED',
  'SecurityError',
  'cross-origin frame',
  'pmtiles',
  'guwahati.pmtiles',
  'MapLibre',
];

// Chunk-loading related errors
const CHUNK_ERROR_PATTERNS = [
  'Failed to load chunk',
  'Loading chunk',
  'ChunkLoadError',
  '_next/static/chunks',
  'Loading CSS chunk',
  'Failed to fetch dynamically imported module',
  'Unable to preload CSS',
];

/**
 * Check if an error message matches known suppressed patterns
 */
function shouldSuppressError(message: string): boolean {
  if (!message || getSigningOutState()) return true;

  const lowerMessage = message.toLowerCase();
  return SUPPRESSED_ERROR_PATTERNS.some(pattern =>
    lowerMessage.includes(pattern.toLowerCase())
  );
}

/**
 * Check if error is a chunk loading failure
 */
function isChunkLoadError(message: string): boolean {
  if (!message) return false;

  return CHUNK_ERROR_PATTERNS.some(pattern =>
    message.includes(pattern)
  );
}

/**
 * Normalize error message for display and logging
 */
export function normalizeErrorMessage(error: any): string {
  if (!error) return 'An unknown error occurred';

  // Handle Event / MapLibre DOM objects safely without triggering Window serialization SecurityErrors
  if (typeof error === 'object') {
    if (typeof Event !== 'undefined' && error instanceof Event) {
      return `Event: ${error.type || 'unknown'}`;
    }

    // Try common error properties
    const message = error.message || error.error || error.reason || error.detail;
    if (message && typeof message === 'string') return message;

    if (Object.keys(error).length === 0) {
      return 'An unexpected issue occurred.';
    }

    // Try to stringify for debugging safely
    try {
      const stringified = JSON.stringify(error);
      if (stringified === '{}') {
        return 'An unexpected issue occurred.';
      }
    } catch {
      // Ignore cross-origin stringify errors
    }
  }

  if (typeof error === 'string') {
    return error || 'An error occurred';
  }

  return 'An unexpected error occurred';
}

/**
 * Handle chunk loading failures gracefully
 */
function handleChunkLoadError(message: string) {
  chunkFailureCount++;
  console.warn(`📦 Chunk load failure #${chunkFailureCount}:`, message);

  // Store for debugging
  try {
    sessionStorage.setItem('last_chunk_error', JSON.stringify({
      message,
      timestamp: new Date().toISOString(),
      count: chunkFailureCount
    }));
  } catch {
    // Ignore
  }

  // After multiple failures, suggest or auto-reload
  if (chunkFailureCount >= MAX_CHUNK_FAILURES_BEFORE_RELOAD) {
    console.warn('🔄 Multiple chunk failures detected. Attempting to recover...');

    // Clear the chunk failure count
    chunkFailureCount = 0;

    // Try to reload the page to get fresh chunks
    // Wait a moment to allow any pending operations to complete
    setTimeout(() => {
      // Only reload if user is still on the page and online
      if (navigator.onLine && !document.hidden) {
        window.location.reload();
      }
    }, 1000);
  }
}

/**
 * Handle visibility change (app foreground/background)
 */
function handleVisibilityChange() {
  if (document.hidden) {
    // Clear any pending reconnect attempts
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
  } else {

    // Check network status and trigger reconnection if needed
    if (navigator.onLine) {
      // Dispatch a custom event that components can listen to for refreshing data
      window.dispatchEvent(new CustomEvent('app-foreground'));

      // Reset chunk failure count on foreground
      chunkFailureCount = 0;
    } else {
      console.warn('⚠️ App foregrounded but device is offline');
    }
  }
}

/**
 * Handle online/offline status changes
 */
function handleOnlineStatusChange() {
  const isOnline = navigator.onLine;

  if (isOnline && !lastOnlineStatus) {
    // Just came back online

    // Clear any pending reconnect
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
    }

    // Wait a moment for network to stabilize, then signal reconnection
    reconnectTimeoutId = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('app-reconnected'));
      reconnectTimeoutId = null;
    }, 1000);

  } else if (!isOnline && lastOnlineStatus) {
    // Just went offline
    window.dispatchEvent(new CustomEvent('app-offline'));
  }

  lastOnlineStatus = isOnline;
}

/**
 * Initialize mobile error handling
 * Call this once in your root layout or app component
 */
export function initMobileErrorHandler() {
  if (isInitialized || typeof window === 'undefined') {
    return;
  }


  // Initialize online status
  lastOnlineStatus = navigator.onLine;

  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const errorMessage = normalizeErrorMessage(event.reason);

    // Check if we should suppress this error
    if (shouldSuppressError(errorMessage)) {
      event.preventDefault();
      return;
    }

    // Check for chunk loading errors
    if (isChunkLoadError(errorMessage)) {
      event.preventDefault();
      handleChunkLoadError(errorMessage);
      return;
    }

    console.error('❌ Unhandled Promise Rejection:', errorMessage);

    // Prevent the default behavior (which might crash the app)
    event.preventDefault();

    // Log to console for debugging (safely guarded against cross-origin property access)
    try {
      if (event.reason instanceof Error) {
        console.error('Error details:', {
          message: event.reason.message || 'No message',
          name: event.reason.name || 'Unknown',
          stack: typeof event.reason.stack === 'string' ? event.reason.stack : 'No stack trace'
        });
      }
    } catch {
      // Ignore Window / cross-origin inspection errors
    }

    // Store in sessionStorage for debugging
    try {
      const errors = JSON.parse(sessionStorage.getItem('app_errors') || '[]');
      errors.push({
        type: 'unhandledrejection',
        message: errorMessage,
        timestamp: new Date().toISOString(),
      });
      // Keep only last 10 errors
      if (errors.length > 10) errors.shift();
      sessionStorage.setItem('app_errors', JSON.stringify(errors));
    } catch (e) {
      // Ignore sessionStorage errors
    }
  });

  // Catch uncaught errors
  window.addEventListener('error', (event) => {
    const errorMessage = normalizeErrorMessage(event.error || event.message);

    // Check if we should suppress this error
    if (shouldSuppressError(errorMessage)) {
      event.preventDefault();
      return;
    }

    // Check for chunk loading errors
    if (isChunkLoadError(event.message || errorMessage)) {
      event.preventDefault();
      handleChunkLoadError(event.message || errorMessage);
      return;
    }

    console.error('❌ Uncaught Error:', errorMessage);

    // Prevent the default behavior
    event.preventDefault();

    // Log details
    console.error('Error details:', {
      message: event.message || 'No message',
      filename: event.filename || 'Unknown file',
      lineno: event.lineno || 0,
      colno: event.colno || 0,
    });

    // Store for debugging
    try {
      const errors = JSON.parse(sessionStorage.getItem('app_errors') || '[]');
      errors.push({
        type: 'error',
        message: errorMessage,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        timestamp: new Date().toISOString(),
      });
      if (errors.length > 10) errors.shift();
      sessionStorage.setItem('app_errors', JSON.stringify(errors));
    } catch (e) {
      // Ignore sessionStorage errors
    }
  });

  // Catch resource loading errors (images, scripts, etc.)
  window.addEventListener('error', (event) => {
    if (event.target && (event.target as any).tagName) {
      const target = event.target as HTMLElement;
      const tagName = target.tagName?.toLowerCase();
      const src = (target as any).src || (target as any).href;

      // Check if it's a chunk loading failure
      if (src && isChunkLoadError(src)) {
        handleChunkLoadError(`Resource failed to load: ${src}`);
      } else {
        // Only log non-chunk resource failures
        console.warn('⚠️ Resource failed to load:', {
          tag: tagName,
          src: src || 'unknown'
        });
      }
    }
  }, true); // Use capture phase

  // Handle visibility changes
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Handle online/offline status
  window.addEventListener('online', handleOnlineStatusChange);
  window.addEventListener('offline', handleOnlineStatusChange);

  // Detect low memory warnings on mobile
  if ('onmemorywarning' in window) {
    (window as any).addEventListener('memorywarning', () => {
      console.warn('⚠️ Low memory warning!');
      // Clear caches, unload unnecessary data
      try {
        // Clear old localStorage data (except critical items)
        const keysToKeep = ['applicationDraft', 'currentPaymentSession', 'adtu_bus_user_data'];
        Object.keys(localStorage).forEach(key => {
          if (!keysToKeep.includes(key)) {
            localStorage.removeItem(key);
          }
        });
      } catch (e) {
        console.error('Failed to clear cache:', e);
      }
    });
  }

  isInitialized = true;
}

/**
 * Get logged errors for debugging
 */
export function getLoggedErrors(): any[] {
  try {
    return JSON.parse(sessionStorage.getItem('app_errors') || '[]');
  } catch {
    return [];
  }
}

/**
 * Clear logged errors
 */
export function clearLoggedErrors() {
  try {
    sessionStorage.removeItem('app_errors');
  } catch {
    // Ignore
  }
}

/**
 * Check if app is running on mobile device.
 * Canonical implementation is in @/lib/mobile-utils — imported here for reuse.
 */
import { isMobileDevice } from '@/lib/mobile-utils';
export { isMobileDevice };

/**
 * Get device info for debugging
 */
export function getDeviceInfo() {
  if (typeof window === 'undefined') {
    return {
      isMobile: false,
      platform: 'server',
      userAgent: 'server'
    };
  }

  return {
    isMobile: isMobileDevice(),
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    language: navigator.language,
    cookieEnabled: navigator.cookieEnabled,
    onLine: navigator.onLine,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    screen: {
      width: window.screen.width,
      height: window.screen.height
    }
  };
}
