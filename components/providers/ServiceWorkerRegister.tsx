'use client';

import { useEffect } from 'react';
// Loaded on every page so the browser's one-off install prompt is caught
// early, for the Install button (components/InstallApp.tsx).
import '@/components/InstallApp';
import { captureRefFromUrl } from '@/lib/referral';

/**
 * Registers the offline/installability service worker (public/sw.js).
 * Production-only and best-effort — a registration failure here should
 * never affect the app itself, so every error is swallowed.
 */
export function ServiceWorkerRegister() {
  // A rep's shared link (…?ref=CODE) can open any page: keep the code for
  // sign-up.
  useEffect(() => { captureRefFromUrl(); }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Installability/offline-fallback is a nice-to-have, not critical path.
    });
  }, []);

  return null;
}
