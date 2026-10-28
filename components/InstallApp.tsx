'use client';

import { useEffect, useState } from 'react';
import { Check, Download, Share, SquarePlus, X } from 'lucide-react';

// "Add to Home Screen". Android/Chrome hands us an install prompt to show
// on a tap; iPhones have no prompt, so we show the three Safari steps. On
// iPhone it's also what makes notifications possible (Safari only allows
// web push for home-screen apps).

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// The browser fires this once, often before any component mounts, so it
// is caught as soon as this module loads.
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach(fn => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach(fn => fn());
  });
}

const DISMISS_KEY = 'pastcs_install_dismissed_at';
const DISMISS_DAYS = 14;

type Platform = 'installed' | 'prompt' | 'ios' | 'other';

function detect(): Platform {
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return 'installed';
  if (deferred) return 'prompt';
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios ? 'ios' : 'other';
}

function usePlatform(): Platform | null {
  const [platform, setPlatform] = useState<Platform | null>(null);
  useEffect(() => {
    const update = () => setPlatform(detect());
    update();
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, []);
  return platform;
}

async function install(onDone: () => void) {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice.catch(() => null);
  deferred = null;
  onDone();
}

function IosSteps() {
  return (
    <ol className="space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
      <li className="flex items-start gap-2"><span className="font-semibold w-4 flex-shrink-0">1.</span><span>Open PastCS in <strong>Safari</strong> and tap <Share className="inline w-4 h-4 -mt-1 mx-0.5" aria-label="Share" /> <strong>Share</strong> at the bottom of the screen.</span></li>
      <li className="flex items-start gap-2"><span className="font-semibold w-4 flex-shrink-0">2.</span><span>Scroll down and tap <SquarePlus className="inline w-4 h-4 -mt-1 mx-0.5" aria-label="" /> <strong>Add to Home Screen</strong>.</span></li>
      <li className="flex items-start gap-2"><span className="font-semibold w-4 flex-shrink-0">3.</span><span>Tap <strong>Add</strong>. Open PastCS from its new icon from now on.</span></li>
    </ol>
  );
}

/** A small, dismissible banner for the dashboard. Hidden once installed. */
export function InstallBanner() {
  const platform = usePlatform();
  const [hidden, setHidden] = useState(true);
  const [steps, setSteps] = useState(false);

  useEffect(() => {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      setHidden(Date.now() - at < DISMISS_DAYS * 86400e3);
    } catch { setHidden(false); }
  }, []);

  if (hidden || !platform || platform === 'installed' || platform === 'other') return null;
  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
    setHidden(true);
  };

  return (
    <div role="region" aria-label="Add PastCS to your home screen" className="rounded-2xl border border-gray-200 bg-white p-3 sm:p-4 dark:bg-white/[0.04] dark:border-white/10">
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={40} height={40} className="w-10 h-10 rounded-xl flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Add PastCS to your home screen</p>
          <p className="text-xs text-gray-600 mt-0.5 dark:text-gray-400">
            Opens like an app, full screen.{platform === 'ios' && ' On iPhone it’s also how you get notifications.'}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {platform === 'prompt' ? (
              <button onClick={() => install(() => setHidden(true))} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
                <Download className="w-3.5 h-3.5" />Install
              </button>
            ) : (
              <button onClick={() => setSteps(v => !v)} aria-expanded={steps} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
                {steps ? 'Hide steps' : 'Show me how'}
              </button>
            )}
            <button onClick={dismiss} className="px-2 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400">Not now</button>
          </div>
          {steps && <div className="mt-3"><IosSteps /></div>}
        </div>
        <button onClick={dismiss} aria-label="Close" className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

/** A permanent card for the profile page: status and how to install. */
export function InstallCard() {
  const platform = usePlatform();
  if (!platform) return null;
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:bg-white/[0.04] dark:border-white/10">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={36} height={36} className="w-9 h-9 rounded-lg flex-shrink-0" />
        <p className="font-semibold text-gray-900 dark:text-gray-100">PastCS on your home screen</p>
      </div>
      <div className="mt-3 text-sm text-gray-600 dark:text-gray-400">
        {platform === 'installed' && (
          <p className="flex items-center gap-1.5 text-green-700 dark:text-green-400"><Check className="w-4 h-4" />Installed. You&rsquo;re using the app.</p>
        )}
        {platform === 'prompt' && (
          <div className="space-y-2">
            <p>Install PastCS to open it like an app, full screen, from its own icon.</p>
            <button onClick={() => install(() => window.location.reload())} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              <Download className="w-4 h-4" />Install PastCS
            </button>
          </div>
        )}
        {platform === 'ios' && (
          <div className="space-y-2">
            <p>On iPhone, adding PastCS to your home screen is also what lets it send you notifications.</p>
            <IosSteps />
          </div>
        )}
        {platform === 'other' && (
          <p>On an Android phone, open PastCS in <strong>Chrome</strong>, tap the menu <strong>⋮</strong>, then <strong>Install app</strong> or <strong>Add to Home screen</strong>. On a computer, look for the install icon at the right of Chrome&rsquo;s address bar.</p>
        )}
      </div>
    </div>
  );
}
