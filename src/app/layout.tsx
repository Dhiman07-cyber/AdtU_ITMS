import './globals.css';
import '../styles/animations.css';
import type { Metadata } from 'next';
import { AuthProvider } from '@/contexts/auth-context';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { ToastProvider } from '@/contexts/toast-context';
import { ThemeProvider } from '@/components/theme-provider';
import { suppressConsoleWarnings } from '@/lib/console-suppress';
import SimpleErrorBoundary from '@/components/simple-error-boundary';
import AppShell from '@/components/AppShell';
import MobileErrorHandler from '@/components/MobileErrorHandler';
import SmoothScrollProvider from '@/components/smooth-scroll-provider';
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics as VercelAnalytics } from "@vercel/analytics/next";

declare global {
  interface Window {
    gtag: (...args: unknown[]) => void;
    dataLayer: unknown[];
  }
}

// Suppress Next.js 15 params warnings in development
suppressConsoleWarnings();

const appName = 'AdtU Bus Services';

export const metadata: Metadata = {
  title: {
    template: `%s | ${appName}`,
    default: `${appName} - Integrated Transit Management System`,
  },
  description: 'AdtU ITMS is a comprehensive real-time bus tracking and transit management system for Assam down town University students, drivers, and administration.',
  keywords: ['AdtU', 'Assam down town University', 'Bus Tracking', 'Transit Management', 'Student Transport', 'ITMS'],
  authors: [{ name: 'AdtU IT Cell' }],
  creator: 'Assam down town University',
  openGraph: {
    title: `${appName} - Integrated Transit Management System`,
    description: 'Real-time bus tracking, smart passes, and secure payment management for AdtU transport services.',
    url: 'https://bus.adtu.in',
    siteName: appName,
    locale: 'en_IN',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${appName} - Integrated Transit Management`,
    description: 'Real-time bus tracking and transport management for AdtU.',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: appName,
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/icons/icon-192x192.png',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full dark" suppressHydrationWarning>

      <head />
      <body className="min-h-dvh bg-background text-foreground" suppressHydrationWarning>
        <MobileErrorHandler />
        <SimpleErrorBoundary>
          <ThemeProvider>
            <ToastProvider>
              <AuthProvider>
                <NotificationProvider>
                  <SmoothScrollProvider>
                    <AppShell>
                      {children}
                      <SpeedInsights />
                      <VercelAnalytics />
                    </AppShell>
                  </SmoothScrollProvider>
                </NotificationProvider>
              </AuthProvider>
            </ToastProvider>
          </ThemeProvider>
        </SimpleErrorBoundary>
      </body>
    </html>
  );
}
