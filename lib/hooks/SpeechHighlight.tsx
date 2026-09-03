import { Fragment } from 'react';

interface Props {
  text: string;
  charIndex: number;
  className?: string;
}

export function SpeechHighlight({ text, charIndex, className = '' }: Props) {
  const parts: React.ReactNode[] = [];
  const regex = /(\S+)(\s*)/g;
  let match;
  let i = 0;

  while ((match = regex.exec(text)) !== null) {
    const [, word, space] = match;
    const wordStart = match.index;
    const isActive = charIndex > 0 && charIndex >= wordStart && charIndex < wordStart + word.length;
    parts.push(
      <Fragment key={i++}>
        <span
          style={{
            display: 'inline-block',
            transform: isActive ? 'scale(1.15)' : 'scale(1)',
            transformOrigin: 'center bottom',
            transition: isActive
              ? 'transform 0.08s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.06s ease'
              : 'transform 0.12s ease-out, background-color 0.08s ease',
            backgroundColor: isActive ? '#fde047' : 'transparent',
            // The paragraph's own text color follows the theme (light gray
            // in dark mode) — but the highlight patch itself stays bright
            // yellow either way, so the active word needs its own color
            // pinned dark, or light-on-yellow becomes unreadable.
            color: isActive ? '#1c1917' : 'inherit',
            borderRadius: isActive ? '4px' : '0',
            padding: isActive ? '0 3px' : '0',
            fontWeight: isActive ? 600 : 'inherit',
            zIndex: isActive ? 1 : 'auto',
            position: 'relative',
          }}
        >
          {word}
        </span>
        {space}
      </Fragment>
    );
  }

  return (
    <p className={`text-sm text-gray-800 dark:text-gray-200 leading-relaxed ${className}`}>
      {parts}
    </p>
  );
}
