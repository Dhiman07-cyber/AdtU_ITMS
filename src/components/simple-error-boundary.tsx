"use client";

import { AlertTriangle,RefreshCw,WifiOff } from 'lucide-react';
import { Component,ErrorInfo,ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  isChunkError: boolean;
  isNetworkError: boolean;
}

// Patterns that indicate chunk loading failures
const CHUNK_ERROR_PATTERNS = [
  'Failed to load chunk',
  'Loading chunk',
  'ChunkLoadError',
  '_next/static/chunks',
  'Loading CSS chunk',
  'Failed to fetch dynamically imported module',
  'Unable to preload CSS',
];

// Patterns that indicate network errors
const NETWORK_ERROR_PATTERNS = [
  'Network request failed',
  'Failed to fetch',
  'net::ERR_',
  'Load failed',
  'NetworkError',
];

function isChunkLoadError(message: string): boolean {
  if (!message) return false;
  return CHUNK_ERROR_PATTERNS.some(pattern => message.includes(pattern));
}

function isNetworkError(message: string): boolean {
  if (!message) return false;
  return NETWORK_ERROR_PATTERNS.some(pattern => message.includes(pattern));
}

export default class SimpleErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      isChunkError: false,
      isNetworkError: false,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const errorMessage = error?.message || '';

    return {
      hasError: true,
      error,
      isChunkError: isChunkLoadError(errorMessage),
      isNetworkError: isNetworkError(errorMessage),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const errorMessage = error?.message || 'Unknown error';

    // Log error details
    console.error('SimpleErrorBoundary caught an error:', {
      message: errorMessage,
      isChunkError: this.state.isChunkError,
      isNetworkError: this.state.isNetworkError,
      componentStack: errorInfo.componentStack,
    });

    // Store in sessionStorage for debugging
    try {
      const errors = JSON.parse(sessionStorage.getItem('error_boundary_errors') || '[]');
      errors.push({
        message: errorMessage,
        isChunkError: this.state.isChunkError,
        isNetworkError: this.state.isNetworkError,
        timestamp: new Date().toISOString(),
      });
      if (errors.length > 5) errors.shift();
      sessionStorage.setItem('error_boundary_errors', JSON.stringify(errors));
    } catch {
      // Ignore storage errors
    }
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      isChunkError: false,
      isNetworkError: false,
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { isChunkError, isNetworkError, error } = this.state;

      // Chunk error UI - suggest reload
      if (isChunkError) {
        return (
          <div className="min-h-screen flex items-center justify-center p-4 bg-background">
            <div className="text-center max-w-md">
              <div className="mb-6 flex justify-center">
                <div className="p-4 bg-yellow-100 dark:bg-yellow-900/30 rounded-full">
                  <RefreshCw className="h-8 w-8 text-yellow-600 dark:text-yellow-400" />
                </div>
              </div>
              <h1 className="text-2xl font-bold text-foreground mb-3">
                Update Available
              </h1>
              <p className="text-muted-foreground mb-6">
                A new version of the app is available. Please reload to get the latest updates.
              </p>
              <button
                onClick={this.handleReload}
                className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity flex items-center gap-2 mx-auto"
              >
                <RefreshCw className="h-4 w-4" />
                Reload Page
              </button>
            </div>
          </div>
        );
      }

      // Network error UI
      if (isNetworkError) {
        return (
          <div className="min-h-screen flex items-center justify-center p-4 bg-background">
            <div className="text-center max-w-md">
              <div className="mb-6 flex justify-center">
                <div className="p-4 bg-red-100 dark:bg-red-900/30 rounded-full">
                  <WifiOff className="h-8 w-8 text-red-600 dark:text-red-400" />
                </div>
              </div>
              <h1 className="text-2xl font-bold text-foreground mb-3">
                Connection Error
              </h1>
              <p className="text-muted-foreground mb-6">
                Unable to connect. Please check your internet connection and try again.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={this.handleRetry}
                  className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
                >
                  Try Again
                </button>
                <button
                  onClick={this.handleReload}
                  className="px-6 py-3 bg-secondary text-secondary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
                >
                  Reload Page
                </button>
              </div>
            </div>
          </div>
        );
      }

      // Generic error UI
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-background">
          <div className="text-center max-w-md">
            <div className="mb-6 flex justify-center">
              <div className="p-4 bg-red-100 dark:bg-red-900/30 rounded-full">
                <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-3">
              Something went wrong
            </h1>
            <p className="text-muted-foreground mb-6">
              {error?.message || 'An unexpected error occurred. Please try again.'}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={this.handleRetry}
                className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
              >
                Try Again
              </button>
              <button
                onClick={this.handleReload}
                className="px-6 py-3 bg-secondary text-secondary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}