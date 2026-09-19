'use client';

import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Thin client boundary responsible for redirecting authenticated users
 * to their role-specific dashboard. Mounts on top of the server-rendered
 * landing page — anonymous visitors see the landing page immediately with
 * no JS delay. Logged-in users will see a brief flash before the redirect
 * fires on hydration.
 */
export default function AuthRedirector() {
    const { currentUser, userData, loading, needsApplication } = useAuth();
    const router = useRouter();
    const [isRedirecting, setIsRedirecting] = useState(false);
    const [redirectFailed, setRedirectFailed] = useState(false);

    useEffect(() => {
        if (loading) return;
        if (!currentUser) {
            setIsRedirecting(false);
            return;
        }

        if (userData && userData.role) {
            setIsRedirecting(true);
            router.push(`/${userData.role}`);
        } else if (needsApplication) {
            setIsRedirecting(true);
            router.push('/apply/form');
        } else {
            // Transient state — wait briefly then fall through to landing page
            const timeout = setTimeout(() => {
                setRedirectFailed(true);
                setIsRedirecting(false);
            }, 5000);
            return () => clearTimeout(timeout);
        }
    }, [loading, currentUser, userData, needsApplication, router]);

    // When loading auth on the landing page, return null so anonymous visitors
    // see the fast server-rendered landing page with zero flash.
    if (loading) {
        return null;
    }
    if (isRedirecting && !redirectFailed) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs transition-opacity duration-200">
                <div className="flex flex-col items-center gap-3 p-4 rounded-xl bg-zinc-900/90 border border-zinc-800 text-white shadow-2xl">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                    <p className="text-xs font-medium text-zinc-300">
                        {needsApplication ? 'Redirecting to application...' : 'Redirecting...'}
                    </p>
                </div>
            </div>
        );
    }

    // Unauthenticated or redirect failed — render nothing; parent shows landing page
    return null;
}
