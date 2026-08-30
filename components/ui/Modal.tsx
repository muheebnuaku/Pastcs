'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  // Portals must wait for the client to mount — document isn't available
  // during SSR, and document.body isn't safe to touch before hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen || !mounted) return null;

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
  };

  // Rendered via portal straight onto <body> — several pages wrap their
  // content in `.animate-fade-in`, whose `animation: ... both` fill-mode
  // leaves `transform: translateY(0)` permanently applied after it
  // finishes. Any non-`none` transform on an ancestor turns it into the
  // containing block for `position: fixed` descendants, which silently
  // breaks "fixed inset-0" (it anchors to that ancestor's box instead of
  // the real viewport — the modal renders offset/clipped and, combined
  // with body scroll being locked while open, becomes unreachable). A
  // portal renders outside that tree entirely, so this can't happen no
  // matter what animation/transform any page uses.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 py-8 sm:items-center sm:py-4">
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
      />
      {/*
        Card: a flex column capped at ~90% of the viewport height.
        The body below is `flex-1 min-h-0` — flex children default to
        `min-height: auto`, which (without min-h-0) stops them from ever
        shrinking to fit, so long content spills out past the rounded
        card instead of scrolling in place. min-h-0 + overflow-y-auto is
        what actually makes the body scroll internally, and
        overflow-hidden on the card guards against any residual bleed.
      */}
      <div
        className={cn(
          'relative z-10 flex w-full max-h-[90vh] flex-col overflow-hidden rounded-xl bg-white shadow-xl',
          sizes[size]
        )}
      >
        {title && (
          <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-4 py-4 sm:px-6">
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            <button
              onClick={onClose}
              className="ml-3 flex-shrink-0 rounded-lg p-1 transition-colors hover:bg-gray-100"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
