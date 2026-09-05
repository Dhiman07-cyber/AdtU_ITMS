import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  /* config options here */
  output: process.env.VERCEL ? undefined : 'standalone',
  allowedDevOrigins: [
    '127.0.0.1',
    'localhost',
    '127.0.0.1:3000',
    'localhost:3000',
  ],
  // Performance optimizations
  // Next.js 16 Compiler automatic memoization
  reactCompiler: true,

  experimental: {
    // Next.js 16 Auth Interrupts for forbidden() & unauthorized() boundaries
    authInterrupts: true,
    // Next.js 16 Turbopack Filesystem Caching for faster dev server restarts
    turbopackFileSystemCacheForDev: true,
    optimizePackageImports: [
      'lucide-react',
      'motion',
      'motion/react',
      'recharts',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-popover',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-tabs',
      '@radix-ui/react-scroll-area',
      '@radix-ui/react-avatar',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-label',
      '@radix-ui/react-slot',
      '@supabase/supabase-js',
      'qrcode.react',
      'jsqr',
      'date-fns',
      'firebase',
      'firebase/firestore',
      'firebase/auth',
      'react-hot-toast',
      'zod',
      'crypto-js',
      'class-variance-authority',
      'clsx',
      'tailwind-merge',
    ],
    // Faster builds in development
    serverActions: {
      bodySizeLimit: '10mb',
    },

    // Note: optimizeCss can cause issues with Turbopack, disable for dev
    // optimizeCss: true,
    // Optimize font loading
    optimizeServerReact: true,
  },

  // Turbopack configuration (moved from experimental.turbo)
  turbopack: {
    root: __dirname, // Expicitly set the project root to fix multiple lockfile warning
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },

  // Compiler optimizations
  compiler: {
    // Keep error/warn output in production builds: removeConsole: true strips
    // ALL console calls including error()/warn(), which silenced every server
    // error log in prod and made the WS server and cron routes undebuggable.
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : undefined,
  },

  // Webpack optimizations
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      // Development optimizations
      config.optimization = {
        ...config.optimization,
        removeAvailableModules: false,
        removeEmptyChunks: false,
        splitChunks: false,
      };
      // Enable filesystem caching for faster incremental builds
      config.cache = {
        type: 'filesystem',
        version: '1.0.0',
        cacheDirectory: path.resolve('.next/cache/webpack'),
      };
    } else if (!isServer) {
      // Production optimizations — split large vendors into separate cacheable chunks
      config.optimization.splitChunks = {
        chunks: 'all',
        maxInitialRequests: 25,
        minSize: 20000,
        cacheGroups: {
          firebase: {
            test: /[\\/]node_modules[\\/](firebase|@firebase)[\\/]/,
            name: 'firebase',
            chunks: 'all',
            priority: 40,
          },
          supabase: {
            test: /[\\/]node_modules[\\/](@supabase)[\\/]/,
            name: 'supabase',
            chunks: 'all',
            priority: 35,
          },
          uiLibs: {
            test: /[\\/]node_modules[\\/](@radix-ui|motion|framer-motion|recharts|lucide-react|class-variance-authority)[\\/]/,
            name: 'ui-libs',
            chunks: 'all',
            priority: 30,
          },
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
            priority: 10,
          },
        },
      };
    }
    return config;
  },

  // Configure external image domains
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'api.dicebear.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '**.supabase.in',
        pathname: '/**',
      },
    ],
    // Image optimization settings - prioritize quality
    formats: ['image/webp', 'image/avif'],
    minimumCacheTTL: 14400,
    dangerouslyAllowSVG: false,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    // Disable automatic optimization for Cloudinary URLs to preserve quality
    unoptimized: false,
    loader: 'default',
    // Configure image qualities for Next.js 16 compatibility
    qualities: [25, 50, 75, 90, 100],
  },

  // Add headers for security, mobile compatibility, and Razorpay
  async headers() {
    const isProduction = process.env.NODE_ENV === 'production';

    // Shared security headers for all routes
    const securityHeaders = [
      // HSTS: Force HTTPS in production
      ...(isProduction ? [{
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains; preload',
      }] : []),
      // COOP header configured for Firebase Auth popup compatibility
      {
        key: 'Cross-Origin-Opener-Policy',
        value: 'unsafe-none',
      },
      {
        key: 'Cross-Origin-Embedder-Policy',
        value: 'unsafe-none',
      },
      // CSP headers for Firebase Auth, Razorpay, and mobile compatibility
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://*.razorpay.com https://apis.google.com https://www.gstatic.com https://www.googletagmanager.com https://www.google-analytics.com https://vercel.live https://*.vercel.live https://va.vercel-scripts.com",
          // MapLibre uses a Blob worker in the browser.
          // If worker-src isn't explicitly set, browsers fall back to script-src and will block it.
          "worker-src 'self' blob:",
          "style-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://vercel.live https://*.vercel.live",
          "img-src 'self' data: blob: https: https://res.cloudinary.com https://lh3.googleusercontent.com https://api.dicebear.com https://checkout.razorpay.com https://www.google.com https://vercel.live https://*.vercel.live",
          "font-src 'self' data: https://checkout.razorpay.com https://fonts.openmaptiles.org https://demotiles.maplibre.org https://vercel.live https://*.vercel.live",
          isProduction
            ? "connect-src 'self' ws://* wss://* ws: wss: https://fonts.openmaptiles.org https://demotiles.maplibre.org https://*.razorpay.com https://api.razorpay.com wss://*.supabase.co https://*.supabase.co https://*.supabase.in https://firestore.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://*.googleapis.com https://apis.google.com https://accounts.google.com https://www.google.com https://www.googletagmanager.com https://analytics.google.com https://www.google-analytics.com https://api.cloudinary.com https://*.cloudinary.com https://vercel.live https://*.vercel.live https://vitals.vercel-insights.com"
            : "connect-src 'self' ws://localhost:* ws://127.0.0.1:* ws://* wss://* ws: wss: http://localhost:* https://*.devtunnels.ms https://fonts.openmaptiles.org https://demotiles.maplibre.org https://*.razorpay.com https://api.razorpay.com wss://*.supabase.co https://*.supabase.co https://*.supabase.in https://firestore.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://*.googleapis.com https://apis.google.com https://accounts.google.com https://www.google.com https://www.googletagmanager.com https://analytics.google.com https://www.google-analytics.com https://api.cloudinary.com https://*.cloudinary.com https://vercel.live https://*.vercel.live https://vitals.vercel-insights.com",
          "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://accounts.google.com https://*.firebaseapp.com https://vercel.live https://*.vercel.live https://www.google.com",
          "frame-ancestors 'self' https://accounts.google.com https://*.firebaseapp.com",
          "media-src 'self' blob: data: https://*.supabase.co https://*.supabase.in",
          "base-uri 'self'",
          "form-action 'self' https://api.razorpay.com https://accounts.google.com",
          "object-src 'none'",
          ...(isProduction ? ["upgrade-insecure-requests"] : []),
        ].join('; '),
      },
      // Security headers
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'X-XSS-Protection', value: '1; mode=block' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-DNS-Prefetch-Control', value: 'on' },
      { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(self), microphone=(), geolocation=(self), payment=(self), usb=(), bluetooth=(), serial=(), hid=(), magnetometer=(), gyroscope=(), accelerometer=(self), autoplay=()',
      },
      { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
    ];

    return [
      // ── Public static files: cache with revalidation ──
      {
        source: '/manifest.json',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600, stale-while-revalidate=86400' },
        ],
      },
      // ── API routes: Never cache sensitive data ──
      {
        source: '/api/:path*',
        headers: [
          ...securityHeaders,
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      // ── Health endpoint: Short cache for monitoring tools ──
      // Note: This overrides the /api/:path* Cache-Control for /api/health specifically
      {
        source: '/api/health',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, max-age=0, must-revalidate' },
        ],
      },
      // ── Page routes (excluding API): Security headers + no-cache for HTML pages ──
      // Uses negative lookahead to avoid applying to /api/* routes
      {
        source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
        headers: [
          ...securityHeaders,
          { key: 'Cache-Control', value: 'private, no-cache, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
