'use client';

import { useId } from 'react';

// The Exam Boss: a robot owl drawn after the PastCS logo (dark feathers
// with silver edges, green circuit eyes, yellow beak, graduation cap with
// a yellow tassel, an open book). Its mood drives the animation:
//   idle     floats and blinks
//   charge   powering up an attack (the countdown is running low)
//   attack   lunges at you (you answered wrong or ran out of time)
//   hurt     shakes and flashes (you landed a hit)
//   enraged  red eyes, trembling (below half health)
//   ko       knocked out: tilted, grey, X eyes, cap knocked off
//   taunt    you lost; it gloats
// `beat` restarts the one-shot animations (hurt, attack) each time it changes.

export type BossMood = 'idle' | 'charge' | 'attack' | 'hurt' | 'enraged' | 'ko' | 'taunt';

const GREEN = '#4ade80';
const RED = '#f87171';
const SILVER = '#c7cdd4';
const SILVER_DIM = '#8b939c';

export function BossOwl({ mood = 'idle', beat = 0, className = '', label }: {
  mood?: BossMood;
  beat?: number;
  className?: string;
  label?: string;
}) {
  const id = useId().replace(/:/g, '');
  const angry = mood === 'enraged' || mood === 'attack' || mood === 'taunt';
  const ko = mood === 'ko';
  const eye = angry ? RED : GREEN;
  // The shake waits for the bolt to land (see HitEffect).
  const oneShot = mood === 'hurt' ? 'boss-shake boss-late' : mood === 'attack' ? 'boss-lunge' : '';
  const body = ko ? 'boss-ko' : mood === 'enraged' ? 'boss-tremble' : 'boss-float';

  return (
    <div key={`${mood}-${beat}`} className={`${oneShot} ${className}`} role="img" aria-label={label ?? 'The Exam Boss, a robot owl'}>
      <div className={body}>
        <svg viewBox="0 0 240 240" className="w-full h-auto overflow-visible" aria-hidden="true">
          <defs>
            <filter id={`${id}-glow`} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <radialGradient id={`${id}-aura`}>
              <stop offset="0%" stopColor={eye} stopOpacity="0.55" />
              <stop offset="100%" stopColor={eye} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${id}-feather`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2b3139" />
              <stop offset="100%" stopColor="#15191e" />
            </linearGradient>
          </defs>

          {/* Aura when powering up or angry */}
          {(mood === 'charge' || angry) && !ko && (
            <circle cx="120" cy="120" r="112" fill={`url(#${id}-aura)`} className="boss-aura" />
          )}

          {/* Data pixels drifting off its head */}
          <g className="boss-pixel" fill={ko ? SILVER_DIM : eye} filter={`url(#${id}-glow)`} opacity={ko ? 0.3 : 0.9}>
            <rect x="22" y="58" width="9" height="9" /><rect x="38" y="46" width="11" height="11" /><rect x="34" y="70" width="13" height="13" />
            <rect x="52" y="62" width="7" height="7" /><rect x="18" y="80" width="7" height="7" /><rect x="46" y="88" width="8" height="8" />
            <rect x="200" y="64" width="7" height="7" /><rect x="212" y="78" width="9" height="9" />
          </g>

          {/* Wings, behind */}
          {[1, -1].map(side => (
            <g key={side} transform={side === -1 ? 'translate(240 0) scale(-1 1)' : undefined}>
              <path d="M66 138 C40 156 38 200 66 222 L74 208 L60 202 L72 192 L56 184 L68 174 L54 164 L66 154 Z"
                fill={`url(#${id}-feather)`} stroke={SILVER} strokeWidth="2" strokeLinejoin="round" />
              <path d="M62 170 L72 166 M60 188 L70 184 M64 206 L72 200" stroke={SILVER_DIM} strokeWidth="1.5" strokeLinecap="round" />
            </g>
          ))}

          {/* Body */}
          <path d="M64 150 C54 192 82 226 120 228 C158 226 186 192 176 150 C170 124 70 124 64 150 Z" fill={`url(#${id}-feather)`} stroke="#3a414b" strokeWidth="2" />
          <path d="M98 196 l8 8 l8 -8 M126 196 l8 8 l8 -8 M110 214 l10 8 l10 -8" stroke={SILVER_DIM} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />

          {/* Ear tufts */}
          {[1, -1].map(side => (
            <path key={side} transform={side === -1 ? 'translate(240 0) scale(-1 1)' : undefined}
              d="M68 90 L46 50 L90 72 Z" fill="#20252c" stroke={SILVER} strokeWidth="2" strokeLinejoin="round" />
          ))}

          {/* Head */}
          <path d="M58 112 C52 72 80 50 120 48 C160 50 188 72 182 112 C178 142 150 158 120 160 C90 158 62 142 58 112 Z"
            fill={`url(#${id}-feather)`} stroke={SILVER} strokeWidth="2.5" />
          {/* Facial disc */}
          <path d="M120 78 C100 64 70 68 68 100 C66 130 96 142 120 130 C144 142 174 130 172 100 C170 68 140 64 120 78 Z"
            fill="#2c323a" stroke="#e3e7ec" strokeWidth="2" />

          {/* Brows: a V that sharpens when angry */}
          <g stroke={SILVER} strokeWidth="4.5" strokeLinecap="round" fill="none">
            {angry
              ? <><path d="M72 74 L116 96" /><path d="M168 74 L124 96" /></>
              : <><path d="M74 80 Q98 76 116 92" /><path d="M166 80 Q142 76 124 92" /></>}
          </g>

          {/* Eyes */}
          {[96, 144].map((cx, i) => (
            <g key={cx} transform={`translate(${cx} 106)`}>
              <circle r="22" fill="#0a0d11" />
              {ko ? (
                <g stroke={SILVER} strokeWidth="4" strokeLinecap="round"><path d="M-9 -9 L9 9 M9 -9 L-9 9" /></g>
              ) : (
                <g className={mood === 'hurt' ? '' : 'boss-blink'} transform={mood === 'hurt' ? 'scale(1 0.25)' : undefined}>
                  <g filter={`url(#${id}-glow)`} stroke={eye} fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle r="17" />
                    <path d={i === 0 ? 'M-14 7 L-7 1 L-2 1 M10 -10 L5 -4 L5 3 M-3 15 L2 9' : 'M14 7 L7 1 L2 1 M-10 -10 L-5 -4 L-5 3 M3 15 L-2 9'} />
                  </g>
                  <g fill={eye} filter={`url(#${id}-glow)`}>
                    <circle cx={i === 0 ? -14 : 14} cy="7" r="2.4" /><circle cx={i === 0 ? 10 : -10} cy="-10" r="2.4" /><circle cx={i === 0 ? -3 : 3} cy="15" r="2.4" />
                  </g>
                  <circle r={mood === 'charge' ? 7.5 : 6} fill={angry ? '#fff1f2' : '#f0fff4'} filter={`url(#${id}-glow)`} />
                </g>
              )}
            </g>
          ))}

          {/* Beak */}
          <path d="M120 114 L107 124 Q120 150 133 124 Z" fill="#facc15" stroke="#a16207" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M120 116 L113 124 Q120 136 120 136" fill="none" stroke="#fde68a" strokeWidth="1.5" strokeLinecap="round" />

          {/* Graduation cap, knocked off on a KO */}
          <g transform={ko ? 'rotate(-24 120 40) translate(-26 18)' : undefined} style={{ transition: 'transform 0.8s' }}>
            <path d="M82 54 L82 68 Q120 82 158 68 L158 54 Q120 66 82 54 Z" fill="#191d22" stroke="#6b7280" strokeWidth="1.5" />
            <path d="M120 20 L198 44 L120 66 L42 44 Z" fill="#0f1215" stroke={SILVER} strokeWidth="2.2" strokeLinejoin="round" />
            <path d="M120 28 L176 44 L120 60" fill="none" stroke="#2b3139" strokeWidth="1.5" />
            <circle cx="120" cy="43" r="3.2" fill="#facc15" />
            <path d="M120 43 L66 48 L64 72" fill="none" stroke="#facc15" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="58" y="70" width="12" height="20" rx="3" fill="#facc15" stroke="#a16207" strokeWidth="1" />
            <path d="M61 82 L61 90 M64 82 L64 90 M67 82 L67 90" stroke="#a16207" strokeWidth="1" />
          </g>

          {/* The open book it reads your questions from */}
          <path d="M60 176 L64 212 Q96 206 120 218 Q144 206 176 212 L180 176 Q150 172 120 184 Q90 172 60 176 Z" fill="#3a3f46" stroke="#1f2329" strokeWidth="1.5" />
          <path d="M120 182 Q96 170 66 174 L70 206 Q98 202 120 212 Z" fill="#fde68a" stroke="#ca8a04" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M120 182 Q144 170 174 174 L170 206 Q142 202 120 212 Z" fill="#fef3c7" stroke="#ca8a04" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M78 184 Q98 182 112 190 M78 193 Q98 191 112 199 M162 184 Q142 182 128 190 M162 193 Q142 191 128 199"
            stroke="#d6b65a" strokeWidth="1.3" fill="none" strokeLinecap="round" />
          {/* Talons on the book */}
          <path d="M70 196 q-6 4 -4 10 M76 198 q-5 5 -2 10 M170 196 q6 4 4 10 M164 198 q5 5 2 10" stroke={SILVER} strokeWidth="2.2" fill="none" strokeLinecap="round" />

          {/* Hit flash */}
          {mood === 'hurt' && <circle cx="120" cy="110" r="74" fill="#ffffff" className="boss-flash" />}

          {/* Stars round its head when knocked out */}
          {ko && (
            <g className="boss-stars" fill="#facc15">
              {[0, 120, 240].map(a => (
                <path key={a} transform={`rotate(${a} 120 30) translate(120 0)`} d="M0 -7 L2 -2 L7 0 L2 2 L0 7 L-2 2 L-7 0 L-2 -2 Z" />
              ))}
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
