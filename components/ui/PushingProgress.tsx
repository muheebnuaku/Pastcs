'use client';

interface Props {
  value: number;
  max: number;
}

export function PushingProgress({ value, max }: Props) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const isComplete = value >= max && max > 0;
  const isStraining = pct >= 50;
  const isAlmostThere = pct >= 80;

  return (
    <div className="relative h-14 select-none" aria-label={`Question ${value + 1} of ${max}`}>

      {/* Track background */}
      <div className="absolute left-0 right-0 top-[27px] h-3 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden">
        {/* Gradient fill */}
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${pct}%`,
            background: isAlmostThere
              ? 'linear-gradient(90deg,#f59e0b,#ef4444)'
              : 'linear-gradient(90deg,#3b82f6,#6366f1)',
          }}
        />
      </div>

      {/* Goal marker */}
      <div className="absolute right-0 top-[10px] text-xl leading-none pointer-events-none">
        {isComplete ? '🎉' : '🏁'}
      </div>

      {/* Person + Rock — slides with currentIndex */}
      <div
        className="absolute bottom-0 animate-push-strain"
        style={{
          left: `clamp(0px, calc(${pct}% - 52px), calc(100% - 74px))`,
          transition: 'left 0.7s cubic-bezier(0.34,1.56,0.64,1)',
        }}
      >
        <svg width="74" height="54" viewBox="0 0 74 54" fill="none" aria-hidden="true">
          <defs>
            {/* Rock radial gradient — light top-left, dark bottom-right */}
            <radialGradient id="pg-rock" cx="32%" cy="28%" r="65%">
              <stop offset="0%"   stopColor="#cfd8dc" />
              <stop offset="50%"  stopColor="#78909c" />
              <stop offset="100%" stopColor="#37474f" />
            </radialGradient>

            {/* Skin radial gradient */}
            <radialGradient id="pg-skin" cx="42%" cy="38%" r="58%">
              <stop offset="0%"   stopColor="#ffe0b2" />
              <stop offset="100%" stopColor="#ffb74d" />
            </radialGradient>

            {/* Shirt gradient */}
            <radialGradient id="pg-shirt" cx="28%" cy="25%" r="75%">
              <stop offset="0%"   stopColor={isStraining ? '#ef5350' : '#42a5f5'} />
              <stop offset="100%" stopColor={isStraining ? '#b71c1c' : '#1565c0'} />
            </radialGradient>

            {/* Pants gradient */}
            <linearGradient id="pg-pants" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="#1a237e" />
              <stop offset="100%" stopColor="#283593" />
            </linearGradient>
          </defs>

          {/* ── Ground shadows ── */}
          <ellipse cx="54" cy="52" rx="17" ry="3"   fill="rgba(0,0,0,0.13)" />
          <ellipse cx="17" cy="52" rx="11" ry="2.2" fill="rgba(0,0,0,0.10)" />

          {/* ── ROCK ── */}
          <ellipse cx="54" cy="37" rx="17" ry="14" fill="url(#pg-rock)" />
          {/* Highlight (top-left sheen) */}
          <ellipse cx="45" cy="29" rx="5.5" ry="3.5" fill="rgba(255,255,255,0.32)"
            transform="rotate(-15 45 29)" />
          {/* Surface cracks */}
          <path d="M54 25 L51 33 L55 38" stroke="#546e7a" strokeWidth="0.9"
            strokeLinecap="round" opacity="0.5" />
          <path d="M59 30 L57 36" stroke="#546e7a" strokeWidth="0.7"
            strokeLinecap="round" opacity="0.35" />

          {/* ── PERSON ── */}

          {/* Shoes */}
          <ellipse cx="9"  cy="50" rx="6"   ry="2.8" fill="#212121" />
          <ellipse cx="20" cy="48" rx="5.5" ry="2.8" fill="#212121" />

          {/* Left leg (back — straight, providing drive) */}
          <path d="M13 31 L7 48 L12 49 L16 33Z" fill="url(#pg-pants)" />

          {/* Right leg (front — bent at knee) */}
          <path d="M16 31 L21 40 L20 41 L18 48 L23 49 L25 41 L18 31Z"
            fill="url(#pg-pants)" />

          {/* Torso (leaning ~40° forward) */}
          <path d="M8 18 L22 18 L25 31 L11 31Z" fill="url(#pg-shirt)" />
          {/* Shirt highlight */}
          <path d="M10 19 L14 19 L13 27 L10 25Z" fill="rgba(255,255,255,0.18)" />

          {/* Left arm */}
          <path d="M10 21 L2 31 L5 33 L14 23Z" fill="url(#pg-shirt)" />

          {/* Right arm (extended toward rock) */}
          <path d="M20 21 L36 28 L35 31 L18 23Z" fill="url(#pg-shirt)" />
          {/* Forearm highlight */}
          <path d="M20 22 L31 27 L30 29 L19 24Z" fill="rgba(255,255,255,0.12)" />

          {/* Neck */}
          <rect x="13" y="13" width="6" height="6" rx="3" fill="#ffcc80" />

          {/* ── HEAD ── */}
          <circle cx="16" cy="10" r="8" fill="url(#pg-skin)" />

          {/* Hair */}
          <path d="M9 8.5 Q16 2 23 8.5 Q19 5 16 5 Q13 5 9 8.5Z" fill="#4e342e" />

          {/* Left eye */}
          <circle cx="13"  cy="10" r="1.5" fill="#4e342e" />
          <circle cx="13.4" cy="9.5" r="0.55" fill="white" />

          {/* Right eye */}
          <circle cx="19"  cy="10" r="1.5" fill="#4e342e" />
          <circle cx="19.4" cy="9.5" r="0.55" fill="white" />

          {/* Eyebrows — furrowed for effort */}
          <path d="M11 7.5 L14.5 8.2" stroke="#4e342e" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M17.5 8.2 L21 7.5" stroke="#4e342e" strokeWidth="1.2" strokeLinecap="round" />

          {/* Mouth — gritted teeth */}
          <path d="M13 13 L19 13" stroke="#4e342e" strokeWidth="1.1" strokeLinecap="round" />
          <path d="M13 13 L13 14.2" stroke="#4e342e" strokeWidth="0.8" />
          <path d="M15 13 L15 14.2" stroke="#4e342e" strokeWidth="0.8" />
          <path d="M17 13 L17 14.2" stroke="#4e342e" strokeWidth="0.8" />
          <path d="M19 13 L19 14.2" stroke="#4e342e" strokeWidth="0.8" />

          {/* Sweat drops — appear progressively */}
          {pct >= 40 && (
            <ellipse cx="22" cy="6" rx="2" ry="3" fill="#64b5f6" opacity="0.85"
              transform="rotate(20 22 6)" />
          )}
          {pct >= 65 && (
            <ellipse cx="25" cy="12" rx="1.6" ry="2.5" fill="#64b5f6" opacity="0.75"
              transform="rotate(25 25 12)" />
          )}
          {pct >= 85 && (
            <ellipse cx="20" cy="2" rx="1.4" ry="2.2" fill="#64b5f6" opacity="0.7"
              transform="rotate(10 20 2)" />
          )}
        </svg>
      </div>
    </div>
  );
}
