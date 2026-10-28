'use client';

import type { CSSProperties } from 'react';

// A right answer landing on the boss: an energy bolt flies up from your
// side of the arena, then an impact ring, a white flash, sparks and the
// damage number where it hits. A power strike is bigger and gold. The
// bolt takes about 0.26 s; everything else starts as it lands.
// Mount it with a new key for each hit.

export const HIT_LANDS_MS = 260;

export function HitEffect({ power, damage }: { power: boolean; damage: number }) {
  const color = power ? '#facc15' : '#6ee7b7';
  const sparks = power ? 14 : 9;
  const ring = power ? 128 : 84;
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true" data-effect="hit" data-power={power ? 'true' : 'false'}>
      <span data-effect="bolt" className="boss-bolt absolute left-1/2 top-[45%] rounded-full"
        style={{ width: power ? 22 : 14, height: power ? 56 : 38, marginTop: power ? -28 : -19,
          background: `linear-gradient(to top, transparent, ${color} 45%, #ffffff)`,
          boxShadow: `0 0 ${power ? 26 : 14}px ${color}, 0 0 ${power ? 52 : 28}px ${color}` }} />
      <span data-effect="impact" className="boss-impact absolute left-1/2 top-[45%] rounded-full"
        style={{ width: ring, height: ring, border: `${power ? 5 : 3}px solid ${color}`, boxShadow: `0 0 24px ${color}, inset 0 0 18px ${color}` }} />
      <span className="boss-impact absolute left-1/2 top-[45%] rounded-full"
        style={{ width: ring * 0.55, height: ring * 0.55, background: `radial-gradient(circle, #ffffff 0%, ${color} 45%, transparent 70%)` }} />
      {Array.from({ length: sparks }).map((_, i) => (
        <span key={i} data-effect="spark" className="boss-spark absolute left-1/2 top-[45%] rounded-sm"
          style={{
            '--a': `${(360 / sparks) * i + (i % 2 ? 9 : -9)}deg`,
            '--d': `${-(power ? 82 : 58) - (i % 3) * 10}px`,
            width: 4, height: power ? 14 : 10, marginLeft: -2, marginTop: power ? -7 : -5,
            background: i % 2 ? '#ffffff' : color, boxShadow: `0 0 8px ${color}`,
          } as CSSProperties} />
      ))}
      <span data-effect="damage" className="boss-dmg absolute left-1/2 top-0 text-2xl sm:text-3xl font-black tabular-nums"
        style={{ color, textShadow: `0 0 12px ${color}, 0 2px 0 #000` }}>
        −{damage * 10}
      </span>
    </div>
  );
}
