'use client';

import { useEffect } from 'react';

/**
 * Registers the offline/installability service worker (public/sw.js).
 * Production-only and best-effort — a registration failure here should
 * never affect the app itself, so every error is swallowed.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Installability/offline-fallback is a nice-to-have, not critical path.
    });
  }, []);

  return null;
}
