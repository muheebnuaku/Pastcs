'use client';

interface Props {
  value: number;
  max: number;
}

export function PushingProgress({ value, max }: Props) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const isComplete = value >= max && max > 0;

  return (
    <div className="relative h-12 select-none" aria-label={`${value} of ${max} answered`}>
      {/* Track */}
      <div className="absolute left-0 right-0 top-[22px] h-2.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* End flag */}
      <div className="absolute right-0 top-[10px] text-lg leading-none pointer-events-none">
        {isComplete ? '🎉' : '🏁'}
      </div>

      {/* Person + Rock group */}
      <div
        className="absolute bottom-0 flex items-end animate-push-strain"
        style={{
          left: `clamp(0px, calc(${pct}% - 46px), calc(100% - 60px))`,
          transition: 'left 0.7s ease-out',
        }}
      >
        {/* Stick figure in pushing pose */}
        <svg width="26" height="40" viewBox="0 0 26 40" aria-hidden="true">
          {/* Head */}
          <circle cx="8" cy="5.5" r="4.5" fill="#1e40af" />
          {/* Body leaning forward */}
          <line x1="10" y1="10" x2="16" y2="22" stroke="#1e40af" strokeWidth="2.5" strokeLinecap="round" />
          {/* Left arm pushing toward rock */}
          <line x1="12.5" y1="14" x2="24" y2="18" stroke="#1e40af" strokeWidth="2" strokeLinecap="round" />
          {/* Right arm pushing toward rock (slightly lower) */}
          <line x1="12.5" y1="16.5" x2="24" y2="21.5" stroke="#1e40af" strokeWidth="2" strokeLinecap="round" />
          {/* Back leg (straight, providing push) */}
          <line x1="16" y1="22" x2="7" y2="37" stroke="#1e40af" strokeWidth="2.5" strokeLinecap="round" />
          {/* Front leg (bent, stepping forward) */}
          <line x1="16" y1="22" x2="20" y2="31" stroke="#1e40af" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="20" y1="31" x2="15" y2="39" stroke="#1e40af" strokeWidth="2.5" strokeLinecap="round" />
          {/* Sweat drop when past halfway */}
          {pct >= 50 && (
            <ellipse cx="4" cy="8" rx="1.5" ry="2" fill="#93c5fd" opacity="0.85" />
          )}
        </svg>

        {/* Rock / boulder */}
        <svg width="32" height="30" viewBox="0 0 32 30" aria-hidden="true" className="-ml-1.5">
          {/* Main boulder shape */}
          <ellipse cx="16" cy="19" rx="14" ry="10" fill="#64748b" />
          {/* Highlight top-left */}
          <ellipse cx="10" cy="13" rx="5" ry="3" fill="#94a3b8" opacity="0.55" />
          {/* Shadow bottom-right */}
          <ellipse cx="21" cy="22" rx="3" ry="2" fill="#334155" opacity="0.35" />
          {/* Small crack detail */}
          <line x1="16" y1="12" x2="14" y2="18" stroke="#475569" strokeWidth="1" opacity="0.5" />
        </svg>
      </div>
    </div>
  );
}
