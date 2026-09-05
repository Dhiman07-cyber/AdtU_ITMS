'use client';
/**
 * E2E-only sign-in surface for automated staging tests.
 * NOT available in production builds. Signs the app's own firebase-auth
 * instance in with an admin-minted custom token, so every real guard
 * (auth context, role resolution, API calls, WS auth) runs as usual.
 */
import { notFound, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

function SignInInner() {
  const params = useSearchParams();
  const [state, setState] = useState('signing-in');

  useEffect(() => {
    const token = params.get('token');
    if (!token) { setState('error: missing token'); return; }
    (async () => {
      try {
        const { signInWithCustomToken } = await import('firebase/auth');
        const { auth } = await import('@/lib/firebase');
        const cred = await signInWithCustomToken(auth, token);
        setState(`signed-in:${cred.user.uid}`);
      } catch (e: any) {
        setState(`error: ${e?.message || e}`);
      }
    })();
  }, [params]);

  return (
    <div style={{ padding: 24, fontFamily: 'monospace' }}>
      <h1>E2E Sign-In</h1>
      <p data-testid="e2e-signin-status">{state}</p>
    </div>
  );
}

export default function E2eSignInPage() {
  // ponytail: allow in staging Docker image (NODE_ENV=production) when build arg is set
  const isStaging = process.env.NEXT_PUBLIC_E2E_STAGING === 'true';
  if (process.env.NODE_ENV === 'production' && !isStaging) notFound();
  return (
    <Suspense fallback={<div>loading…</div>}>
      <SignInInner />
    </Suspense>
  );
}
