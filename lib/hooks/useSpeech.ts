'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

function stripMarkdown(text: string): string {
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
  const [isSpeaking, setIsSpeaking] = useState(false);
  const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();
    const plain = stripMarkdown(text);
    if (!plain) return;

    const utterance = new SpeechSynthesisUtterance(plain);
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      onEnd?.();
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      onEnd?.();
    };
    utteranceRef.current = utterance;
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [isSupported]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') window.speechSynthesis.cancel();
    };
  }, []);

  return { speak, stop, isSpeaking, isSupported };
}
