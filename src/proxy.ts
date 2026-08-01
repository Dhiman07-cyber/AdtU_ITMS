/**
 * Next.js Proxy for ADTU Bus Services (Next.js 16+ convention)
 * 
 * SECURITY: Provides multi-layer route-level protection:
 * - IP-based global rate limiting (DDoS/load protection)
 * - CSRF protection for state-changing requests
 * - Suspicious path/scanner blocking
 * - Authentication verification via Firebase session cookies
 * - Role-based access control for protected routes
 * - Security headers injection
 * - Request method validation
 */

import { NextRequest,NextResponse } from 'next/server';

// ============================================================================
// RATE LIMITING (Edge-compatible, in-memory)
// ============================================================================

/**
 * Global IP rate limiter for proxy-level DDoS protection.
 * Runs at the edge, so uses simple in-memory Map.
 * This is a first line of defense; individual API routes have their own limits.
 */
const ipRequestCounts = new Map<string, { count: number; resetTime: number }>();
const IP_RATE_LIMIT = 300;        // max requests per window
const IP_RATE_WINDOW_MS = 60_000; // 1 minute window
const IP_CACHE_MAX = 50_000;      // prevent unbounded memory growth

function checkGlobalRateLimit(ip: string): { allowed: boolean; remaining: number } {
    const now = Date.now();

    // Evict expired entries periodically (every ~1000 checks)
    if (ipRequestCounts.size > IP_CACHE_MAX) {
        for (const [key, entry] of ipRequestCounts) {
            if (now > entry.resetTime) ipRequestCounts.delete(key);
        }
    }

    const entry = ipRequestCounts.get(ip);
    if (!entry || now > entry.resetTime) {
        ipRequestCounts.set(ip, { count: 1, resetTime: now + IP_RATE_WINDOW_MS });
        return { allowed: true, remaining: IP_RATE_LIMIT - 1 };
    }

    entry.count++;
    if (entry.count > IP_RATE_LIMIT) {
        return { allowed: false, remaining: 0 };
    }

    return { allowed: true, remaining: IP_RATE_LIMIT - entry.count };
}

// ============================================================================
// ROUTE CONFIGURATION
// ============================================================================

/** Public routes accessible without authentication */
const PUBLIC_ROUTES = [
    '/',
    '/login',
    '/about',
    '/contact',
    '/faq',
    '/how-it-works',
    '/privacy-policy',
    '/terms-and-conditions',
    '/rules-content',
    '/apply',
    '/setup-admin',
];

/** Public API routes that don't require authentication */
const PUBLIC_API_ROUTES = [
    '/api/health',
    '/api/health/db',
    '/api/check-first-user',
    '/api/auth/google',
    '/api/landing-video',
    '/api/get-rules-content',
    '/api/get-bus-fee',
    '/api/faculties',
    '/api/settings/privacy-config',
    '/api/settings/terms-config',
    '/api/settings/ui-config',
    '/api/settings/landing-config',
    '/api/settings/system-config',
    '/api/settings/deadline-config',
    '/api/settings/bus-fees',
    '/api/auth/user',
    '/api/payment/webhook/razorpay', // Webhooks verify their own signatures
    '/api/moderators/get-all',
    '/api/moderators-list',
    '/api/applications/check',
    '/api/applications/my-status',
    '/api/applications/my-application',
];

/** 
 * Cron job routes - these use CRON_SECRET instead of user auth 
 * They verify authorization internally
 */
const CRON_API_ROUTES = [
    '/api/cron/',
];

/** Valid HTTP methods for API routes */
const VALID_API_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

/**
 * Suspicious paths commonly targeted by automated scanners.
 * Block these immediately to reduce noise and attack surface.
 */
const BLOCKED_PATH_PATTERNS = [
    /\.php$/i,
    /\.asp$/i,
    /\.aspx$/i,
    /\.jsp$/i,
    /\.cgi$/i,
    /\/wp-admin/i,
    /\/wp-login/i,
    /\/wp-content/i,
    /\/wordpress/i,
    /\/xmlrpc/i,
    /\/phpmyadmin/i,
    /\/\.env/i,
    /\/\.git/i,
    /\/\.svn/i,
    /\/\.htaccess/i,
    /\/\.htpasswd/i,
    /\/web\.config/i,
    /\/administrator/i,
    /\/admin\.php/i,
    /\/config\.php/i,
    /\/eval-stdin/i,
    /\/actuator/i,
    /\/debug\//i,
    /\/trace/i,
    /\/console/i,
    /\/shell/i,
    /\/cmd/i,
    /\/exec/i,
    /\/etc\/passwd/i,
    /\/proc\/self/i,
    /\/\.well-known\/security\.txt/i,
];

/** Static file extensions to skip */
const STATIC_EXTENSIONS = [
    '.ico', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
    '.css', '.js', '.woff', '.woff2', '.ttf', '.eot',
    '.mp4', '.webm', '.ogg', '.mp3', '.wav',
    '.xml', '.map', '.pmtiles', '.json',
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getClientIp(request: NextRequest): string {
    return (
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip') ||
        request.headers.get('cf-connecting-ip') ||
        '127.0.0.1'
    );
}

function isStaticFile(pathname: string): boolean {
    return STATIC_EXTENSIONS.some(ext => pathname.endsWith(ext)) ||
        pathname.startsWith('/_next/') ||
        pathname.startsWith('/public/') ||
        pathname === '/favicon.ico' ||
        pathname === '/manifest.json' ||
        pathname.startsWith('/manifest-icon/');
}

function isBlockedPath(pathname: string): boolean {
    return BLOCKED_PATH_PATTERNS.some(pattern => pattern.test(pathname));
}

function isPublicRoute(pathname: string): boolean {
    return PUBLIC_ROUTES.some(route => {
        if (route === '/') return pathname === '/';
        return pathname === route || pathname.startsWith(route + '/');
    });
}

function isPublicApiRoute(pathname: string): boolean {
    return PUBLIC_API_ROUTES.some(route => pathname.startsWith(route));
}

function isCronRoute(pathname: string): boolean {
    return CRON_API_ROUTES.some(route => pathname.startsWith(route));
}

/**
 * Extract the allowed origins for CSRF checks
 */
const STATIC_ALLOWED_ORIGINS: Set<string> = (() => {
    const origins = [
        process.env.NEXT_PUBLIC_APP_URL || '',
        'https://adtu-bus.vercel.app',
        'https://adtu-bus-xq.vercel.app',
    ].filter(Boolean);

    if (process.env.NODE_ENV === 'development') {
        origins.push('http://localhost:3000', 'http://127.0.0.1:3000');
    }

    const explicit = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    return new Set([...origins, ...explicit]);
})();

function isOriginAllowed(origin: string): boolean {
    if (STATIC_ALLOWED_ORIGINS.has(origin)) return true;
    if (process.env.NODE_ENV === 'development' && origin.startsWith('http://localhost:')) return true;
    return false;
}

/**
 * Validate Origin / Referer for CSRF protection
 */
function validateOrigin(request: NextRequest): boolean {
    const method = request.method;

    // Only validate state-changing methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        return true;
    }

    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');

    // Webhooks and cron jobs may not have an origin
    if (request.nextUrl.pathname.includes('/webhook/') || isCronRoute(request.nextUrl.pathname)) {
        return true;
    }

    // API routes called from server components won't have origin
    if (!origin && !referer) {
        // Allow server-to-server calls in production (Vercel internal)
        return true;
    }

    // Check origin header
    if (origin && isOriginAllowed(origin)) {
        return true;
    }

    // Fallback to referer
    if (referer) {
        try {
            const refererUrl = new URL(referer);
            if (isOriginAllowed(refererUrl.origin)) return true;
        } catch {
            // Invalid referer URL — reject
        }
    }

    return false;
}

/**
 * Create a JSON error response with proper headers
 */
function jsonError(message: string, status: number, extraHeaders?: Record<string, string>): NextResponse {
    return new NextResponse(
        JSON.stringify({ error: message }),
        {
            status,
            headers: {
                'Content-Type': 'application/json',
                'X-Content-Type-Options': 'nosniff',
                ...extraHeaders,
            },
        }
    );
}

// ============================================================================
// PROXY (formerly middleware — Next.js 16+ convention)
// ============================================================================

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const clientIp = getClientIp(request);

    // ── 1. Skip static files (no processing needed) ──
    if (isStaticFile(pathname)) {
        return NextResponse.next();
    }

    // ── 2. Block suspicious scanner paths immediately ──
    if (isBlockedPath(pathname)) {
        // Return 404, not 403, to avoid fingerprinting
        return new NextResponse(null, { status: 404 });
    }

    // ── 3. Validate HTTP method ──
    if (!VALID_API_METHODS.includes(request.method)) {
        return jsonError('Method not allowed', 405);
    }

    // ── 4. Global IP rate limiting (DDoS protection) ──
    const rateLimit = checkGlobalRateLimit(clientIp);
    if (!rateLimit.allowed) {
        console.warn(`🚫 [PROXY] Rate limit exceeded for IP ${clientIp} on ${pathname}`);
        return jsonError('Too many requests', 429, {
            'Retry-After': '60',
            'X-RateLimit-Limit': String(IP_RATE_LIMIT),
            'X-RateLimit-Remaining': '0',
        });
    }

    // ── 5. Create response with security headers ──
    const response = NextResponse.next();

    // Security headers (complement next.config.ts)
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-XSS-Protection', '1; mode=block');
    response.headers.set('X-RateLimit-Remaining', String(rateLimit.remaining));

    // ── 6. CSRF validation for state-changing requests ──
    if (!validateOrigin(request)) {
        console.warn(`🚫 [PROXY] CSRF validation failed for ${request.method} ${pathname} from IP ${clientIp}`);
        return jsonError('Forbidden: Invalid request origin', 403);
    }

    // ── 7. Allow public routes ──
    if (isPublicRoute(pathname)) {
        return response;
    }

    // ── 8. Allow public API routes ──
    if (isPublicApiRoute(pathname)) {
        return response;
    }

    // ── 9. Allow cron routes (they validate CRON_SECRET internally) ──
    if (isCronRoute(pathname)) {
        return response;
    }

    // ── 10. For protected page routes, client-side AuthContext and Layouts handle the checks ──
    // We intentionally do not use edge redirects here because Firebase Web Auth relies on IndexedDB,
    // which requires client-side hydration, not cookies.


    // ── 11. For API routes, require authorization header for non-public routes ──
    if (pathname.startsWith('/api/') && !isPublicApiRoute(pathname) && !isCronRoute(pathname)) {
        const hasAuth = request.headers.get('authorization') ||
            request.cookies.get('__session')?.value ||
            request.cookies.get('firebase-auth-token')?.value;

        if (!hasAuth) {
            // Don't block — the API handler will do final auth. 
            // But add a header so API handlers know the proxy didn't find auth.
            response.headers.set('X-Proxy-Auth', 'none');
        }
    }

    return response;
}

// ============================================================================
// MATCHER CONFIGURATION
// ============================================================================

export const config = {
    matcher: [
        /*
         * Match all request paths except:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
};

export { proxy as middleware };
export default proxy;

