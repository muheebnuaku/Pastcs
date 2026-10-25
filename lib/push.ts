'use client';

import { createClient } from '@/lib/supabase/client';

// Web push for classroom calls and @mentions (migration 033). The browser
// subscription goes to the database through save_push_subscription; the
// pings themselves are sent by /api/classrooms/push.

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

/** Asks for permission and saves this browser. Returns whether it's now on. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  const json = sub.toJSON();
  const { error } = await createClient().rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
  });
  return !error;
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
