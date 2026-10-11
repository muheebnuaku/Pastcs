'use client';

import { Fragment, useEffect, useMemo, useRef } from 'react';
import type { SpeechPosition } from './useSpeech';

interface Props {
  text: string;
  position: SpeechPosition;
  className?: string;
}

interface Word { word: string; space: string; start: number }

function tokenize(text: string): Word[] {
  const words: Word[] = [];
  const regex = /(\S+)(\s*)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    words.push({ word: match[1], space: match[2], start: match.index });
  }
  return words;
}

// Index of the last word starting at or before `pos`.
function wordAt(words: Word[], pos: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= pos) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return found;
}

/**
 * Read-along text. The highlighted word is moved by toggling a class on
 * two spans directly, subscribed to the speech position — not through
 * React state. Before, every word change re-rendered the whole AI Tutor
 * page (every chat message's markdown included), which is what made the
 * highlight trail behind the voice on phones.
 */
export function SpeechHighlight({ text, position, className = '' }: Props) {
  const words = useMemo(() => tokenize(text), [text]);
  const spansRef = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    let active = -1;
    const apply = () => {
      const next = wordAt(words, position.get());
      if (next === active) return;
      if (active >= 0) spansRef.current[active]?.classList.remove('speech-word-active');
      if (next >= 0) spansRef.current[next]?.classList.add('speech-word-active');
      active = next;
    };
    apply();
    const unsubscribe = position.subscribe(apply);
    const spans = spansRef.current;
    return () => {
      unsubscribe();
      if (active >= 0) spans[active]?.classList.remove('speech-word-active');
    };
  }, [words, position]);

  return (
    <p className={`text-sm text-gray-800 dark:text-gray-200 leading-relaxed ${className}`}>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span ref={el => { spansRef.current[i] = el; }} className="speech-word">{w.word}</span>
          {w.space}
        </Fragment>
      ))}
    </p>
  );
}
