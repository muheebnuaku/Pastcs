'use client';

// PastCS's own chime for a notification that arrives while the app is
// open. (On the lock screen the phone always plays its own sound: web
// push can't choose one.) Off switch kept on this device.

const OFF_KEY = 'pastcs_notify_sound_off';
let ctx: AudioContext | null = null;

export function isNotifySoundOff(): boolean {
  try { return localStorage.getItem(OFF_KEY) === '1'; } catch { return false; }
}

export function setNotifySoundOff(off: boolean) {
  try { if (off) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY); } catch { /* storage unavailable */ }
}

function note(ac: AudioContext, freq: number, at: number, length: number, gain: number) {
  const osc = ac.createOscillator();
  const vol = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  vol.gain.setValueAtTime(0, ac.currentTime + at);
  vol.gain.linearRampToValueAtTime(gain, ac.currentTime + at + 0.015);
  vol.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + at + length);
  osc.connect(vol).connect(ac.destination);
  osc.start(ac.currentTime + at);
  osc.stop(ac.currentTime + at + length + 0.05);
}

/** A soft two-note rising chime (G5 then C6), about half a second. */
export function playNotifySound() {
  if (typeof window === 'undefined' || isNotifySoundOff()) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    note(ctx, 784, 0, 0.32, 0.12);
    note(ctx, 1047, 0.12, 0.42, 0.1);
  } catch { /* audio unavailable */ }
}
