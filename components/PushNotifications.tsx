'use client';

import { useEffect, useState } from 'react';
import { BellRing, Check, X } from 'lucide-react';
import {
  disablePush, pushDeviceState, pushPromptSnoozed, resyncPush, snoozePushPrompt, turnOnPush, type PushDeviceState,
} from '@/lib/push';

// Phone notifications for everything in the bell, like WhatsApp: on the
// lock screen, as a pop-up, and as a count on the app icon, even when
// PastCS is closed. On iPhone this only works once PastCS is on the home
// screen (InstallApp shows how); Safari in a tab can't do web push.

function useDeviceState(): [PushDeviceState | null, (s: PushDeviceState) => void] {
  const [state, setState] = useState<PushDeviceState | null>(null);
  useEffect(() => {
    let cancelled = false;
    pushDeviceState().then(s => { if (!cancelled) setState(s); });
    return () => { cancelled = true; };
  }, []);
  return [state, setState];
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function BlockedHelp() {
  return isIos()
    ? <>Open your iPhone&rsquo;s <strong>Settings</strong>, tap <strong>Notifications</strong>, then <strong>PastCS</strong>, and turn on <strong>Allow Notifications</strong>.</>
    : <>Tap the icon to the left of the address bar (or open your phone&rsquo;s <strong>Settings &gt; Apps &gt; PastCS &gt; Notifications</strong>) and allow notifications.</>;
}

/** No UI: keeps this device's subscription attached to whoever is signed in. */
export function PushSync() {
  useEffect(() => { resyncPush(); }, []);
  return null;
}

/** Dashboard banner, until notifications are on here or they say "Not now". */
export function PushBanner() {
  const [state, setState] = useDeviceState();
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setHidden(pushPromptSnoozed()); }, []);

  if (hidden || state !== 'off') return null;

  const dismiss = () => { snoozePushPrompt(); setHidden(true); };
  const turnOn = async () => {
    setBusy(true);
    const result = await turnOnPush();
    setBusy(false);
    setState(await pushDeviceState());
    if (!result.on) setError(result.reason);
  };

  return (
    <div role="region" aria-label="Turn on notifications" className="rounded-2xl border border-gray-200 bg-white p-3 sm:p-4 dark:bg-white/[0.04] dark:border-white/10">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#fde3da] flex items-center justify-center flex-shrink-0 dark:bg-[#e8603c]/15">
          <BellRing className="w-5 h-5 text-[#e8603c]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Turn on notifications</p>
          <p className="text-xs text-gray-600 mt-0.5 dark:text-gray-400">
            See class calls, @mentions, payments and messages on your lock screen, even when PastCS is closed.
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button onClick={turnOn} disabled={busy} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {busy ? 'Turning on…' : 'Turn on'}
            </button>
            <button onClick={dismiss} className="px-2 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400">Not now</button>
          </div>
          {error && <p role="alert" className="text-xs text-red-600 mt-2 dark:text-red-400">{error}</p>}
        </div>
        <button onClick={dismiss} aria-label="Close" className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

/** Profile card: this device's notifications, with a test. */
export function PushCard() {
  const [state, setState] = useDeviceState();
  const [busy, setBusy] = useState<'toggle' | 'test' | null>(null);
  const [note, setNote] = useState('');

  if (!state) return null;

  const toggle = async () => {
    setBusy('toggle');
    setNote('');
    if (state === 'on') await disablePush().catch(() => {});
    else {
      const result = await turnOnPush();
      if (!result.on) setNote(result.reason);
    }
    setState(await pushDeviceState());
    setBusy(null);
  };

  const test = async () => {
    setBusy('test');
    setNote('');
    const res = await fetch('/api/push/test', { method: 'POST' }).catch(() => null);
    const body = await res?.json().catch(() => ({})) as { error?: string } | undefined;
    setBusy(null);
    setNote(res?.ok
      ? 'Sent. Lock your phone: it should arrive in a few seconds.'
      : body?.error ?? 'Couldn’t send a test. Try again.');
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:bg-white/[0.04] dark:border-white/10">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-[#fde3da] flex items-center justify-center flex-shrink-0 dark:bg-[#e8603c]/15">
          <BellRing className="w-5 h-5 text-[#e8603c]" />
        </div>
        <p className="font-semibold text-gray-900 dark:text-gray-100">Notifications on this phone</p>
      </div>
      <div className="mt-3 text-sm text-gray-600 dark:text-gray-400">
        {state === 'unsupported' && (
          isIos()
            ? <p>On iPhone, add PastCS to your home screen first (see above), open it from the new icon, then turn notifications on here.</p>
            : <p>This browser can&rsquo;t show notifications. Open PastCS in <strong>Chrome</strong>, or install it to your home screen.</p>
        )}
        {state === 'blocked' && <p>Notifications are blocked for PastCS. <BlockedHelp /></p>}
        {state === 'off' && <p>Get class calls, @mentions, payments and messages on your lock screen, even when PastCS is closed.</p>}
        {state === 'on' && (
          <p className="flex items-center gap-1.5 text-green-700 dark:text-green-400"><Check className="w-4 h-4 flex-shrink-0" />On. Alerts show on your lock screen, like any app.</p>
        )}
        {(state === 'off' || state === 'on') && (
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              onClick={toggle}
              disabled={busy !== null}
              className={state === 'on'
                ? 'rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5'
                : 'rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60'}
            >
              {busy === 'toggle' ? 'Saving…' : state === 'on' ? 'Turn off' : 'Turn on notifications'}
            </button>
            {state === 'on' && (
              <button onClick={test} disabled={busy !== null} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                {busy === 'test' ? 'Sending…' : 'Send a test'}
              </button>
            )}
          </div>
        )}
        {note && <p role="status" className="text-xs mt-2 text-gray-600 dark:text-gray-400">{note}</p>}
      </div>
    </div>
  );
}
