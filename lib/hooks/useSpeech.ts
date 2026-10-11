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

export function useSpeech() {
  const [isSpeaking, setIsSpeaking]     = useState(false);
  const [isPaused, setIsPaused]         = useState(false);
  const [charIndex, setCharIndex]       = useState(0);
  const [speakingText, setSpeakingText] = useState('');
  const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  // Bumped on every speak/stop. speechSynthesis.cancel() fires onend /
  // onerror on the utterance it kills; without this, stopping one reading
  // would trigger the next chunk (or the caller's onEnd) of the old one.
  const sessionRef = useRef(0);

  const stop = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    sessionRef.current++;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    setCharIndex(0);
    setSpeakingText('');
  }, []);

  // Pauses in place — the same utterance resumes from where it left off.
  const pause = useCallback(() => {
    if (typeof window === 'undefined' || !isSpeaking) return;
    window.speechSynthesis.pause();
    setIsPaused(true);
  }, [isSpeaking]);

  const resume = useCallback(() => {
    if (typeof window === 'undefined' || !isPaused) return;
    window.speechSynthesis.resume();
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
    window.speechSynthesis.cancel();
    const plain = stripMarkdown(text);
    if (!plain) { onEnd?.(); return; }

    const pieces = splitForSpeech(plain);
    const storedGender = (localStorage.getItem(VOICE_PREF_KEY) ?? 'female') as 'female' | 'male';
    const voice = pickVoice(storedGender);

    setSpeakingText(plain);
    setCharIndex(0);
    setIsSpeaking(true);
    setIsPaused(false);

    const finish = () => {
      if (session !== sessionRef.current) return;
      setIsSpeaking(false);
      setIsPaused(false);
      setCharIndex(0);
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
      utterance.onboundary = (e) => {
        if (session === sessionRef.current && e.name === 'word') setCharIndex(offset + e.charIndex);
      };
      utterance.onend = () => speakPiece(i + 1);
      utterance.onerror = (e) => {
        if (session !== sessionRef.current) return;
        // Interrupted by the browser/OS (not by us — we bump the session
        // first): end cleanly. Any other failure skips just this piece.
        if (e.error === 'interrupted' || e.error === 'canceled') finish();
        else speakPiece(i + 1);
      };
      window.speechSynthesis.speak(utterance);
    };

    speakPiece(0);
  }, [isSupported]);

  useEffect(() => {
    const sessions = sessionRef;
    return () => {
      sessions.current++;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  return { speak, stop, pause, resume, primeSpeech, isSpeaking, isPaused, charIndex, speakingText, isSupported };
}
