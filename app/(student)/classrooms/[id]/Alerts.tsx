'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  currentPushSubscription, disablePush, enablePush, pushPromptSnoozed, pushSupported, snoozePushPrompt,
} from '@/lib/push';
import { BellRing, Bell, BellOff, X } from 'lucide-react';

type DeviceState = 'unsupported' | 'blocked' | 'off' | 'on';

async function deviceState(): Promise<DeviceState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return (await currentPushSubscription()) ? 'on' : 'off';
}

// Shown on a classroom page (so only once a student has joined one) until
// they turn notifications on or say "Not now".
export function PushPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    deviceState().then(s => { if (!cancelled) setShow(s === 'off' && !pushPromptSnoozed()); });
    return () => { cancelled = true; };
  }, []);

  if (!show) return null;

  const turnOn = async () => {
    setBusy(true);
    await enablePush().catch(() => false);
    setBusy(false);
    // Whatever they chose in the browser's own prompt, don't ask again here.
    snoozePushPrompt();
    setShow(false);
  };

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-3.5 dark:border-blue-500/20 dark:bg-blue-500/10">
      <BellRing className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5 dark:text-blue-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">Know when your class needs you</p>
        <p className="text-sm text-blue-800 dark:text-blue-300">Get a notification when a class call starts or someone @mentions you. Never for every message.</p>
        <div className="flex flex-wrap gap-2 mt-2.5">
          <button onClick={turnOn} disabled={busy} className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 px-3 py-1.5 rounded-lg">
            {busy ? 'Turning on…' : 'Turn on notifications'}
          </button>
          <button onClick={() => { snoozePushPrompt(); setShow(false); }} className="text-xs font-medium text-blue-800 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-white/10">
            Not now
          </button>
        </div>
      </div>
      <button onClick={() => { snoozePushPrompt(); setShow(false); }} aria-label="Dismiss" className="p-1 -m-1 text-blue-400 hover:text-blue-600 flex-shrink-0 dark:text-blue-400/70">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// Members tab: alerts for this classroom (calls and @mentions, in the app
// and as push), and whether this device gets push notifications at all.
export function AlertSettings({ classroomId, userId }: { classroomId: string; userId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [device, setDevice] = useState<DeviceState | null>(null);
  const [busy, setBusy] = useState<'class' | 'device' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    createClient()
      .from('classroom_members')
      .select('alerts_enabled')
      .eq('classroom_id', classroomId)
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error: err }: { data: { alerts_enabled?: boolean } | null; error: unknown }) => {
        // Before migration 033 the column doesn't exist: hide the switch.
        if (!cancelled) setEnabled(err || typeof data?.alerts_enabled !== 'boolean' ? null : data.alerts_enabled);
      });
    deviceState().then(s => { if (!cancelled) setDevice(s); });
    return () => { cancelled = true; };
  }, [classroomId, userId]);

  if (enabled === null) return null;

  const setClass = async (on: boolean) => {
    setBusy('class');
    setError('');
    const { error: err } = await createClient().rpc('set_classroom_alerts', { p_classroom: classroomId, p_enabled: on });
    setBusy(null);
    if (err) { setError('Couldn’t save that. Try again.'); return; }
    setEnabled(on);
  };

  const toggleDevice = async () => {
    setBusy('device');
    setError('');
    if (device === 'on') await disablePush().catch(() => {});
    else if (!(await enablePush().catch(() => false))) setError('Notifications weren’t turned on. Check your browser allows them for this site.');
    setDevice(await deviceState());
    setBusy(null);
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:bg-white/[0.04] dark:border-white/10">
      <h2 className="font-semibold text-gray-900 dark:text-gray-100">Alerts</h2>
      <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">When a class call starts or someone @mentions you. New messages only show as a badge.</p>
      <div className="grid grid-cols-2 gap-2">
        {([
          [true, 'Alerts on', Bell],
          [false, 'Muted', BellOff],
        ] as const).map(([on, label, Icon]) => {
          const active = enabled === on;
          return (
            <button
              key={label}
              onClick={() => !active && setClass(on)}
              disabled={busy === 'class'}
              aria-pressed={active}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                active
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-gray-200 text-gray-700 hover:border-blue-300 dark:bg-white/[0.04] dark:border-white/10 dark:text-gray-300'
              }`}
            >
              <Icon className="w-4 h-4" />{label}
            </button>
          );
        })}
      </div>
      {device && device !== 'unsupported' && (
        <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-white/10">
          <p className="flex-1 min-w-[12rem] text-sm text-gray-700 dark:text-gray-300">
            {device === 'on' && 'Notifications are on for this device.'}
            {device === 'off' && 'Get alerts on this device even when PastCS is closed.'}
            {device === 'blocked' && 'Notifications are blocked for PastCS in your browser settings.'}
          </p>
          {device !== 'blocked' && (
            <button
              onClick={toggleDevice}
              disabled={busy === 'device'}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5"
            >
              {device === 'on' ? 'Turn off on this device' : 'Turn on'}
            </button>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-600 mt-2 dark:text-red-400">{error}</p>}
    </section>
  );
}
