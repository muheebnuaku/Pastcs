'use client';

import { createClient } from '@/lib/supabase/client';

// Web push: phone notifications even when PastCS is closed. The browser
// subscription goes to the database through save_push_subscription (033).
// Classroom calls and @mentions are sent by /api/classrooms/push; every
// other notification by /api/push/drain (046).

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

// "Not now" on the prompt — asked again after this long.
export const PUSH_PROMPT_KEY = 'pastcs_push_prompt_dismissed';
const PROMPT_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && !!VAPID_PUBLIC_KEY
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  // Production registers sw.js on load (ServiceWorkerRegister); this also
  // covers dev and a first visit where that hasn't finished yet.
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js');
}

/** This browser's current subscription, if push is switched on here. */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

export type PushDeviceState = 'unsupported' | 'blocked' | 'off' | 'on';

export async function pushDeviceState(): Promise<PushDeviceState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return (await currentPushSubscription()) ? 'on' : 'off';
}

async function save(sub: PushSubscription): Promise<boolean> {
  const json = sub.toJSON();
  const { error } = await createClient().rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
  });
  return !error;
}

/**
 * On each app open, where permission is already given: re-saves this
 * browser for whoever is signed in now (another account may have used
 * it), and quietly re-subscribes if the browser dropped the old one.
 * Never asks for permission.
 */
export async function resyncPush(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
    await save(sub);
  } catch { /* best effort */ }
}

/** The unread count on the home-screen icon; 0 clears it. */
export function setAppBadgeCount(count: number) {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (count > 0) nav.setAppBadge?.(count).catch(() => {});
  else nav.clearAppBadge?.().catch(() => {});
}

function within<T>(ms: number, p: Promise<T>, reason: string): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(reason)), ms))]);
}

export type PushResult = { on: true } | { on: false; reason: string };

/**
 * Asks for permission and saves this browser. Each of the phone's own
 * steps has a time limit: a browser that never answers (no Google push
 * service, a stuck service worker) used to leave the button spinning.
 */
export async function turnOnPush(): Promise<PushResult> {
  if (!pushSupported()) return { on: false, reason: 'This browser can’t show notifications. Open PastCS in Google Chrome.' };
  let permission: NotificationPermission;
  try {
    permission = await within(60_000, Notification.requestPermission(), 'prompt');
  } catch {
    return { on: false, reason: 'The permission question didn’t appear. Close PastCS completely, open it again and retry.' };
  }
  if (permission === 'denied') return { on: false, reason: 'Notifications are blocked for PastCS. Allow them in your phone’s settings, then try again.' };
  if (permission !== 'granted') return { on: false, reason: 'Tap again and choose Allow when your phone asks.' };

  let reg: ServiceWorkerRegistration;
  try {
    reg = await within(25_000, registration(), 'worker');
    await within(25_000, navigator.serviceWorker.ready, 'worker');
  } catch {
    return { on: false, reason: 'PastCS’s background helper didn’t start. Close PastCS completely, open it again and retry.' };
  }

  let sub: PushSubscription;
  try {
    sub = (await reg.pushManager.getSubscription())
      ?? (await within(20_000, reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }), 'subscribe'));
  } catch {
    return { on: false, reason: 'This browser couldn’t sign up for notifications. Use Google Chrome: Brave, Opera Mini and some phone browsers block them.' };
  }

  try {
    if (!(await within(15_000, save(sub), 'save'))) throw new Error('save');
  } catch {
    return { on: false, reason: 'Couldn’t save this phone. Check your connection and try again.' };
  }
  return { on: true };
}

/** Asks for permission and saves this browser. Returns whether it's now on. */
export async function enablePush(): Promise<boolean> {
  return (await turnOnPush()).on;
}

export async function disablePush(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await createClient().rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
  await sub.unsubscribe().catch(() => {});
}

export function pushPromptSnoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(PUSH_PROMPT_KEY) ?? 0);
    return Date.now() - at < PROMPT_SNOOZE_MS;
  } catch {
    return false;
  }
}

export function snoozePushPrompt() {
  try { localStorage.setItem(PUSH_PROMPT_KEY, String(Date.now())); } catch { /* storage unavailable */ }
}

/** Fire and forget after posting a call or a message with mentions. */
export function requestClassroomPush(messageId: string) {
  fetch('/api/classrooms/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId }),
    keepalive: true,
  }).catch(() => {});
}
