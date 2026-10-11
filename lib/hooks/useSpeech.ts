'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export const VOICE_PREF_KEY = 'pastcs_voice_gender';

const FEMALE_PATTERNS = /female|woman|zira|samantha|victoria|karen|moira|susan|fiona|tessa|veena|eva|alice|emma|joanna|kendra|kimberly|salli|nicole|monica|nora|amelie|anna|claire|aria|jenny|libby|sonia/i;
const MALE_PATTERNS   = /\bmale\b|man|alex|daniel|fred|ralph|thomas|oliver|george|rishi|luca|markus|henrik|jorge|carlos|david|james|aaron|guy|ryan/i;
// Browsers ship much better-sounding voices under these names (Edge's
// "Online (Natural)", Chrome's "Google …", Apple's "Enhanced"/"Premium")
// — prefer them over the default robotic one when present.
const NATURAL_PATTERNS = /natural|neural|google|enhanced|premium/i;

function pickVoice(gender: 'female' | 'male'): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const pattern = gender === 'female' ? FEMALE_PATTERNS : MALE_PATTERNS;
  const en = voices.filter(v => v.lang.startsWith('en'));
  return en.find(v => NATURAL_PATTERNS.test(v.name) && pattern.test(v.name))
    ?? en.find(v => pattern.test(v.name))
    ?? en.find(v => NATURAL_PATTERNS.test(v.name))
    ?? voices.find(v => pattern.test(v.name))
    ?? null;
}

export function stripMarkdown(text: string): string {
  return text
    // The trailing "📚 Resources" block is links for reading, not for
    // listening to.
    .replace(/(^|\n)(-{3,}\s*\n)?#{1,6}\s*📚[^\n]*[\s\S]*$/, '')
    .replace(/```[\s\S]*?```/g, 'code block. ')
    .replace(/`[^`\n]+`/g, '')
    .replace(/^#{1,6}\s/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Tables: drop the |---| separator row, read each row as "a, b, c."
    .replace(/^\|?[ \t:|-]+\|[ \t:|-]*\n?/gm, '')
    .replace(/^\|(.*)\|[ \t]*$/gm, (_m, row: string) =>
      `${row.split('|').map(c => c.trim()).filter(Boolean).join(', ')}.`)
    .replace(/^[*\-]\s/gm, '')
    .replace(/^\d+\.\s/gm, '')
    .replace(/^---$/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    // Paragraph joins can double up punctuation ("growth.. ")
    .replace(/([.!?:])\s*\.(?=\s|$)/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Chrome silently stops a single utterance after ~15 seconds, so long text
// is spoken as a series of short sentence-sized pieces instead.
const MAX_CHUNK_CHARS = 220;

function splitForSpeech(text: string): { text: string; offset: number }[] {
  const pieces: { text: string; offset: number }[] = [];
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  let current = '';
  let currentStart = 0;
  let cursor = 0;

  const push = (piece: string, start: number) => {
    if (piece.trim()) pieces.push({ text: piece, offset: start });
  };

  for (const sentence of sentences) {
    if (current && current.length + sentence.length > MAX_CHUNK_CHARS) {
      push(current, currentStart);
      current = '';
    }
    if (!current) currentStart = cursor;
    if (sentence.length > MAX_CHUNK_CHARS) {
      // One very long sentence: break it on spaces.
      let start = cursor;
      let rest = sentence;
      while (rest.length > MAX_CHUNK_CHARS) {
        let cut = rest.lastIndexOf(' ', MAX_CHUNK_CHARS);
        if (cut <= 0) cut = MAX_CHUNK_CHARS;
        push(rest.slice(0, cut + 1), start);
        start += cut + 1;
        rest = rest.slice(cut + 1);
      }
      current = rest;
      currentStart = start;
    } else {
      current += sentence;
    }
    cursor += sentence.length;
  }
  push(current, currentStart);
  return pieces;
}

// The spoken position changes on every word, so it lives outside React
// state: subscribers (SpeechHighlight, keyword-picture lookup) read it
// directly instead of every word re-rendering the whole page.
function createPositionStore() {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: number) => {
      if (next === value) return;
      value = next;
      listeners.forEach(l => l());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export type SpeechPosition = {
  get: () => number;
  subscribe: (listener: () => void) => () => void;
};

export function useSpeech() {
  const [isSpeaking, setIsSpeaking]     = useState(false);
  const [isPaused, setIsPaused]         = useState(false);
  const [position] = useState(createPositionStore);
  const [speakingText, setSpeakingText] = useState('');
  const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  // Bumped on every speak/stop. speechSynthesis.cancel() fires onend /
  // onerror on the utterance it kills; without this, stopping one reading
  // would trigger the next chunk (or the caller's onEnd) of the old one.
  const sessionRef = useRef(0);

  // Word highlighting normally follows the browser's word "boundary"
  // events, but many voices never send them (Chrome's "Google" voices,
  // most Android phones, some iOS voices) — the highlight then sat still.
  // When a piece gets no boundary events, the position is estimated from
  // elapsed speaking time instead, recalibrated from each finished piece.
  const estimatorRef = useRef<number | null>(null);
  const charsPerSecRef = useRef(15);
  const pausedAtRef = useRef<number | null>(null);
  const pausedTotalRef = useRef(0);

  const clearEstimator = useCallback(() => {
    if (estimatorRef.current !== null) {
      window.cancelAnimationFrame(estimatorRef.current);
      estimatorRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    sessionRef.current++;
    clearEstimator();
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    position.set(0);
    setSpeakingText('');
  }, [clearEstimator, position]);

  // Pauses in place — the same utterance resumes from where it left off.
  const pause = useCallback(() => {
    if (typeof window === 'undefined' || !isSpeaking) return;
    window.speechSynthesis.pause();
    if (pausedAtRef.current === null) pausedAtRef.current = performance.now();
    setIsPaused(true);
  }, [isSpeaking]);

  const resume = useCallback(() => {
    if (typeof window === 'undefined' || !isPaused) return;
    window.speechSynthesis.resume();
    if (pausedAtRef.current !== null) {
      pausedTotalRef.current += performance.now() - pausedAtRef.current;
      pausedAtRef.current = null;
    }
    setIsPaused(false);
  }, [isPaused]);

  // iOS only allows speech that starts inside a tap. Call this from the
  // tap that turns voice on, so replies that finish later can be read out.
  const primeSpeech = useCallback(() => {
    if (!isSupported) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }, [isSupported]);

  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (!isSupported) return;
    const session = ++sessionRef.current;
    clearEstimator();
    window.speechSynthesis.cancel();
    const plain = stripMarkdown(text);
    if (!plain) { onEnd?.(); return; }

    const pieces = splitForSpeech(plain);
    const storedGender = (localStorage.getItem(VOICE_PREF_KEY) ?? 'female') as 'female' | 'male';
    const voice = pickVoice(storedGender);

    setSpeakingText(plain);
    position.set(0);
    setIsSpeaking(true);
    setIsPaused(false);

    const finish = () => {
      if (session !== sessionRef.current) return;
      clearEstimator();
      setIsSpeaking(false);
      setIsPaused(false);
      position.set(0);
      setSpeakingText('');
      onEnd?.();
    };

    const speakPiece = (i: number) => {
      if (session !== sessionRef.current) return;
      if (i >= pieces.length) { finish(); return; }
      const { text: pieceText, offset } = pieces[i];
      const utterance = new SpeechSynthesisUtterance(pieceText);
      utterance.rate = 0.95;
      utterance.pitch = 1;
      if (voice) utterance.voice = voice;

      let gotBoundary = false;
      let startedAt = 0;
      const spokenSeconds = () => {
        const pausedNow = pausedAtRef.current !== null ? performance.now() - pausedAtRef.current : 0;
        return (performance.now() - startedAt - pausedTotalRef.current - pausedNow) / 1000;
      };

      utterance.onstart = () => {
        if (session !== sessionRef.current) return;
        startedAt = performance.now();
        pausedTotalRef.current = 0;
        pausedAtRef.current = null;
        position.set(offset);
        clearEstimator();
        // Every animation frame — cheap now that it only touches two spans.
        const tick = () => {
          if (session !== sessionRef.current || gotBoundary) { estimatorRef.current = null; return; }
          if (pausedAtRef.current === null) {
            const pos = Math.min(pieceText.length - 1, Math.floor(spokenSeconds() * charsPerSecRef.current));
            position.set(offset + Math.max(0, pos));
          }
          estimatorRef.current = window.requestAnimationFrame(tick);
        };
        estimatorRef.current = window.requestAnimationFrame(tick);
      };
      utterance.onboundary = (e) => {
        if (session !== sessionRef.current || e.name !== 'word') return;
        gotBoundary = true;
        position.set(offset + e.charIndex);
      };
      utterance.onend = () => {
        if (session !== sessionRef.current) return;
        clearEstimator();
        // Learn this voice's real speed so the next estimate lines up better.
        if (!gotBoundary && startedAt) {
          // The end event lands after a short trailing silence, which would
          // otherwise read as slower speech and make the highlight lag.
          const seconds = spokenSeconds() - 0.25;
          if (seconds > 0.6) {
            const measured = Math.min(30, Math.max(6, pieceText.length / seconds));
            charsPerSecRef.current = charsPerSecRef.current * 0.4 + measured * 0.6;
          }
        }
        speakPiece(i + 1);
      };
      utterance.onerror = (e) => {
        if (session !== sessionRef.current) return;
        clearEstimator();
        // Interrupted by the browser/OS (not by us — we bump the session
        // first): end cleanly. Any other failure skips just this piece.
        if (e.error === 'interrupted' || e.error === 'canceled') finish();
        else speakPiece(i + 1);
      };
      window.speechSynthesis.speak(utterance);
    };

    speakPiece(0);
  }, [isSupported, clearEstimator, position]);

  useEffect(() => {
    const sessions = sessionRef;
    const estimator = estimatorRef;
    return () => {
      sessions.current++;
      if (estimator.current !== null) window.cancelAnimationFrame(estimator.current);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  return { speak, stop, pause, resume, primeSpeech, isSpeaking, isPaused, position, speakingText, isSupported };
}
