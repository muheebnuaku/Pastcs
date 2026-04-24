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
        <span className={isActive ? 'bg-yellow-300 text-gray-900 rounded px-0.5 transition-colors duration-100' : ''}>
          {word}
        </span>
        {space}
      </Fragment>
    );
  }

  return (
    <p className={`text-sm text-gray-800 leading-relaxed ${className}`}>
      {parts}
    </p>
  );
}
