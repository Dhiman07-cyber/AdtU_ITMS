'use client';

import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

declare global {
  interface Window {
    gtag: (...args: unknown[]) => void;
    dataLayer: unknown[];
  }
}

/**
 * Universal event tracker for Google Analytics 4
 */
export function trackEvent(eventName: string, parameters?: Record<string, unknown>) {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', eventName, parameters);
  } else if (process.env.NODE_ENV === 'development') {
    console.log('[GA4 Debug Event]:', eventName, parameters);
  }
}

export default function Analytics() {
  const measurementId =
    process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ||
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Track client-side route navigation
  useEffect(() => {
    if (measurementId && typeof window !== 'undefined' && typeof window.gtag === 'function') {
      const qs = searchParams?.toString();
      const url = pathname + (qs ? `?${qs}` : '');
      window.gtag('config', measurementId, {
        page_path: url,
      });
    }
  }, [pathname, searchParams, measurementId]);

  // Do not load live GTM in development mode or if no measurement ID is configured
  if (process.env.NODE_ENV === 'development' || !measurementId) {
    return null;
  }

  return (
    <>
      {/* Global Site Tag (gtag.js) - Google Analytics 4 (Loaded with lazyOnload to avoid preload violations and LCP degradation) */}
      <Script
        strategy="lazyOnload"
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
      />
      <Script
        id="google-analytics-init"
        strategy="lazyOnload"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){window.dataLayer.push(arguments);}
            window.gtag = gtag;
            gtag('js', new Date());
            gtag('config', '${measurementId}', {
              page_path: window.location.pathname,
              send_page_view: true
            });
          `,
        }}
      />
    </>
  );
}
