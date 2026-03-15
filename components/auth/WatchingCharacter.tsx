'use client';

import { useEffect, useState } from 'react';

interface WatchingCharacterProps {
  isHiding: boolean;
}

export function WatchingCharacter({ isHiding }: WatchingCharacterProps) {
  const [blinking, setBlinking] = useState(false);

  // Random blink every 2–5 seconds (only when watching)
  useEffect(() => {
    if (isHiding) return;
    let timeout: ReturnType<typeof setTimeout>;
    const scheduleBlink = () => {
      const delay = 2000 + Math.random() * 3000;
      timeout = setTimeout(() => {
        setBlinking(true);
        setTimeout(() => { setBlinking(false); scheduleBlink(); }, 150);
      }, delay);
    };
    scheduleBlink();
    return () => clearTimeout(timeout);
  }, [isHiding]);

  const eyesClosed = isHiding || blinking;

  return (
    <div className="flex justify-center mb-2">
      {/* Wrapper clips the hands when they rest below the face */}
      <div style={{ width: 128, height: 126, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
        <svg
          viewBox="0 0 128 128"
          width="128"
          height="128"
          style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}
        >
          {/* ── HAIR (back layer) ── */}
          <ellipse cx="64" cy="48" rx="42" ry="34" fill="#3D2010" />

          {/* ── FACE ── */}
          <circle cx="64" cy="62" r="37" fill="#FFDBB5" />

          {/* ── EARS ── */}
          <ellipse cx="27" cy="64" rx="7" ry="9" fill="#FFDBB5" />
          <ellipse cx="101" cy="64" rx="7" ry="9" fill="#FFDBB5" />
          <ellipse cx="27" cy="64" rx="4" ry="6" fill="#F0C090" />
          <ellipse cx="101" cy="64" rx="4" ry="6" fill="#F0C090" />

          {/* ── HAIR (front / bangs) ── */}
          <path
            d="M22 55 Q26 24 44 22 Q60 18 76 22 Q96 24 106 52"
            fill="#5A3218"
          />
          {/* Side hair strands */}
          <path d="M22 55 Q16 70 20 88" fill="none" stroke="#3D2010" strokeWidth="8" strokeLinecap="round" />
          <path d="M106 52 Q112 68 108 86" fill="none" stroke="#3D2010" strokeWidth="8" strokeLinecap="round" />

          {/* ── BLUSH ── */}
          <ellipse cx="40" cy="72" rx="10" ry="7" fill="#FFB0B0" opacity="0.5" />
          <ellipse cx="88" cy="72" rx="10" ry="7" fill="#FFB0B0" opacity="0.5" />

          {/* ── EYEBROWS ── */}
          <path
            d={isHiding
              ? 'M37 48 Q46 43 55 47'   // raised in surprise/shy
              : 'M37 51 Q46 46 55 50'   // normal
            }
            fill="none" stroke="#3D2010" strokeWidth="2.5" strokeLinecap="round"
            style={{ transition: 'all 0.3s ease' }}
          />
          <path
            d={isHiding
              ? 'M73 47 Q82 43 91 48'
              : 'M73 50 Q82 46 91 51'
            }
            fill="none" stroke="#3D2010" strokeWidth="2.5" strokeLinecap="round"
            style={{ transition: 'all 0.3s ease' }}
          />

          {/* ── EYES ── */}
          {eyesClosed ? (
            <>
              {/* Closed / squinted arcs */}
              <path d="M37 61 Q46 53 55 61" fill="none" stroke="#3D2010" strokeWidth="3" strokeLinecap="round" />
              <path d="M73 61 Q82 53 91 61" fill="none" stroke="#3D2010" strokeWidth="3" strokeLinecap="round" />
              {/* Eyelash hints */}
              <line x1="37" y1="61" x2="34" y2="58" stroke="#3D2010" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="55" y1="61" x2="58" y2="58" stroke="#3D2010" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="73" y1="61" x2="70" y2="58" stroke="#3D2010" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="91" y1="61" x2="94" y2="58" stroke="#3D2010" strokeWidth="1.5" strokeLinecap="round" />
            </>
          ) : (
            <>
              {/* Open eyes with sparkle */}
              <ellipse cx="46" cy="61" rx="9" ry="10" fill="white" />
              <circle cx="47" cy="63" r="6" fill="#2D1B00" />
              <circle cx="43" cy="59" r="2.5" fill="white" />
              <circle cx="50" cy="67" r="1" fill="white" opacity="0.7" />
              {/* Eyelashes top */}
              <line x1="37" y1="55" x2="39" y2="52" stroke="#3D2010" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="43" y1="52" x2="43" y2="49" stroke="#3D2010" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="50" y1="52" x2="51" y2="49" stroke="#3D2010" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="55" y1="55" x2="57" y2="53" stroke="#3D2010" strokeWidth="1.5" strokeLinecap="round" />

              <ellipse cx="82" cy="61" rx="9" ry="10" fill="white" />
              <circle cx="83" cy="63" r="6" fill="#2D1B00" />
              <circle cx="79" cy="59" r="2.5" fill="white" />
              <circle cx="86" cy="67" r="1" fill="white" opacity="0.7" />
              <line x1="73" y1="55" x2="71" y2="52" stroke="#3D2010" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="79" y1="52" x2="78" y2="49" stroke="#3D2010" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="85" y1="52" x2="85" y2="49" stroke="#3D2010" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="91" y1="55" x2="93" y2="53" stroke="#3D2010" strokeWidth="1.5" strokeLinecap="round" />
            </>
          )}

          {/* ── NOSE ── */}
          <path d="M60 72 Q64 77 68 72" fill="none" stroke="#CC8866" strokeWidth="1.5" strokeLinecap="round" />

          {/* ── MOUTH ── */}
          <path
            d={isHiding
              ? 'M50 83 Q64 90 78 83'   // slightly open / nervous
              : 'M50 83 Q64 93 78 83'   // big happy smile
            }
            fill={isHiding ? 'none' : 'none'}
            stroke="#CC5544"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ transition: 'all 0.4s ease' }}
          />
          {/* Mouth fill for open smile */}
          {!isHiding && (
            <path d="M50 83 Q64 93 78 83 Q64 97 50 83" fill="#FFB0B0" opacity="0.4" />
          )}

          {/* ── LEFT HAND ── slides up from below to cover left eye */}
          <g
            style={{
              transform: isHiding ? 'translateY(-86px)' : 'translateY(0)',
              transition: 'transform 0.5s cubic-bezier(0.34, 1.4, 0.64, 1)',
            }}
          >
            {/* Fingers (rendered above palm in SVG order = on top visually) */}
            <ellipse cx="18" cy="146" rx="5.5" ry="9" fill="#FFDBB5" />
            <ellipse cx="27" cy="142" rx="5.5" ry="10" fill="#FFDBB5" />
            <ellipse cx="36" cy="141" rx="5.5" ry="11" fill="#FFDBB5" />
            <ellipse cx="45" cy="143" rx="5.5" ry="9.5" fill="#FFDBB5" />
            {/* Palm */}
            <ellipse cx="32" cy="155" rx="20" ry="14" fill="#FFDBB5" />
            {/* Knuckle lines */}
            <line x1="18" y1="150" x2="18" y2="154" stroke="#F0C090" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="27" y1="149" x2="27" y2="154" stroke="#F0C090" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="36" y1="149" x2="36" y2="154" stroke="#F0C090" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="45" y1="150" x2="45" y2="154" stroke="#F0C090" strokeWidth="1.5" strokeLinecap="round" />
          </g>

          {/* ── RIGHT HAND ── slides up from below to cover right eye */}
          <g
            style={{
              transform: isHiding ? 'translateY(-86px)' : 'translateY(0)',
              transition: 'transform 0.5s cubic-bezier(0.34, 1.4, 0.64, 1)',
            }}
          >
            <ellipse cx="83" cy="143" rx="5.5" ry="9.5" fill="#FFDBB5" />
            <ellipse cx="92" cy="141" rx="5.5" ry="11" fill="#FFDBB5" />
            <ellipse cx="101" cy="142" rx="5.5" ry="10" fill="#FFDBB5" />
            <ellipse cx="110" cy="146" rx="5.5" ry="9" fill="#FFDBB5" />
            {/* Palm */}
            <ellipse cx="96" cy="155" rx="20" ry="14" fill="#FFDBB5" />
            <line x1="83" y1="150" x2="83" y2="154" stroke="#F0C090" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="92" y1="149" x2="92" y2="154" stroke="#F0C090" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="101" y1="149" x2="101" y2="154" stroke="#F0C090" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="110" y1="150" x2="110" y2="154" stroke="#F0C090" strokeWidth="1.5" strokeLinecap="round" />
          </g>
        </svg>
      </div>
    </div>
  );
}
