'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export const VOICE_PREF_KEY = 'pastcs_voice_gender';

const FEMALE_PATTERNS = /female|woman|zira|samantha|victoria|karen|moira|susan|fiona|tessa|veena|eva|alice|emma|joanna|kendra|kimberly|salli|nicole|monica|nora|amelie|anna|claire/i;
const MALE_PATTERNS   = /\bmale\b|man|alex|daniel|fred|ralph|thomas|oliver|george|rishi|luca|markus|henrik|jorge|carlos|david|james|aaron/i;

function pickVoice(gender: 'female' | 'male'): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const pattern = gender === 'female' ? FEMALE_PATTERNS : MALE_PATTERNS;
  const en = voices.filter(v => v.lang.startsWith('en'));
  return en.find(v => pattern.test(v.name)) ?? voices.find(v => pattern.test(v.name)) ?? null;
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, 'code block. ')
    .replace(/`[^`\n]+`/g, '')
    .replace(/^#{1,6}\s/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[*\-]\s/gm, '')
    .replace(/^\d+\.\s/gm, '')
    .replace(/^---$/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function useSpeech() {
  const [isSpeaking, setIsSpeaking]     = useState(false);
  const [charIndex, setCharIndex]       = useState(0);
  const [speakingText, setSpeakingText] = useState('');
  const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setCharIndex(0);
    setSpeakingText('');
  }, []);

  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();
    const plain = stripMarkdown(text);
    if (!plain) return;

    setSpeakingText(plain);
    setCharIndex(0);

    const utterance = new SpeechSynthesisUtterance(plain);
    utterance.rate = 0.95;
    utterance.pitch = 1;

    const storedGender = (localStorage.getItem(VOICE_PREF_KEY) ?? 'female') as 'female' | 'male';
    const voice = pickVoice(storedGender);
    if (voice) utterance.voice = voice;

    utterance.onboundary = (e) => {
      if (e.name === 'word') setCharIndex(e.charIndex);
    };
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      setCharIndex(0);
      setSpeakingText('');
      onEnd?.();
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setCharIndex(0);
      setSpeakingText('');
      onEnd?.();
    };
    utteranceRef.current = utterance;
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [isSupported]);

  useEffect(() => {
    return () => { if (typeof window !== 'undefined') window.speechSynthesis.cancel(); };
  }, []);

  return { speak, stop, isSpeaking, charIndex, speakingText, isSupported };
}
