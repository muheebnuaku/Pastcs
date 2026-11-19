'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { dayColour, dayLabel, type StatusDay } from '@/lib/status';

/** Reloads the page's data every so often, so it's live without a refresh. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

/** 90 days of uptime (30 on phones). Hover or tap a day for details. */
export function UptimeBars({ days }: { days: StatusDay[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(null); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const shown = open !== null ? days[open] : null;
  const first = days.length - 30;

  return (
    <div ref={box} className="relative mt-3">
      <div className="flex gap-[2px] h-8" onMouseLeave={() => setOpen(null)}>
        {days.map((d, i) => (
          <button
            key={d.day}
            type="button"
            onMouseEnter={e => { setLeft(e.currentTarget.offsetLeft + e.currentTarget.offsetWidth / 2); setOpen(i); }}
            onClick={e => { setLeft(e.currentTarget.offsetLeft + e.currentTarget.offsetWidth / 2); setOpen(open === i ? null : i); }}
            aria-label={`${dayLabel(d.day, true)}: ${d.pct === null ? 'no data' : `${d.pct}% uptime`}`}
            className={`flex-1 min-w-0 rounded-[2px] hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2b2420] ${i < first ? 'hidden sm:block' : ''}`}
            style={{ background: dayColour(d.pct) }}
          />
        ))}
      </div>
      {shown && open !== null && (
        <div
          role="tooltip"
          className="absolute z-10 top-10 w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-[#efe2d0] bg-white p-3 shadow-lg text-sm"
          style={{ left: `clamp(0px, ${left}px - 7.5rem, calc(100% - 15rem))` }}
        >
          <p className="font-bold text-[#2b2420]">{dayLabel(shown.day, true)}</p>
          <p className="text-[#8a7f6f]">{shown.pct === null ? 'No checks recorded' : `${shown.pct}% of checks passed`}</p>
          {shown.incidents && shown.incidents.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {shown.incidents.map((x, k) => <li key={k} className="text-[#4a4038]">• {x.title}</li>)}
            </ul>
          ) : (
            shown.pct !== null && <p className="mt-1 text-[#22a06b]">No incidents</p>
          )}
        </div>
      )}
    </div>
  );
}
