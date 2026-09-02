'use client';

import { useEffect, useState } from 'react';

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Live-ticking countdown to a target Date, recomputed every second.
 * Returns null while there's no target, or once the target has passed —
 * the caller decides what to show in either case (e.g. "no date set" /
 * "exam day" messaging instead of a countdown that's stuck at zero). */
export function useCountdown(target: Date | null): Countdown | null {
  const [countdown, setCountdown] = useState<Countdown | null>(null);
  const targetMs = target?.getTime() ?? null;

  useEffect(() => {
    if (targetMs === null) {
      setCountdown(null);
      return;
    }

    const tick = () => {
      const diff = targetMs - Date.now();
      if (diff <= 0) {
        setCountdown(null);
        return;
      }
      setCountdown({
        days: Math.floor(diff / 86_400_000),
        hours: Math.floor((diff % 86_400_000) / 3_600_000),
        minutes: Math.floor((diff % 3_600_000) / 60_000),
        seconds: Math.floor((diff % 60_000) / 1_000),
      });
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  return countdown;
}
