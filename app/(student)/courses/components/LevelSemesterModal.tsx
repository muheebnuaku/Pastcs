'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/components/providers';
import { usePricing } from '@/lib/hooks/usePricing';
import { Button } from '@/components/ui';
import { X, ArrowRight, BookOpen, Loader2 } from 'lucide-react';

const LEVELS = [
  { value: 100, label: 'L100', desc: 'Year 1' },
  { value: 200, label: 'L200', desc: 'Year 2' },
  { value: 300, label: 'L300', desc: 'Year 3' },
  { value: 400, label: 'L400', desc: 'Year 4' },
] as const;

interface Props {
  onSuccess: () => void;
  onClose?: () => void;
  isChanging?: boolean;
}

export function LevelSemesterModal({ onSuccess, onClose, isChanging = false }: Props) {
  const { user, refreshUser } = useAuth();
  const [selectedLevel, setSelectedLevel] = useState<number | null>(
    user?.selected_level ?? null
  );
  const [selectedSemester, setSelectedSemester] = useState<number | null>(
    user?.selected_semester ?? null
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const { label: priceLabel } = usePricing(selectedLevel);

  // Portal to <body> — see Modal.tsx: rendering inline under a page that
  // uses .animate-fade-in breaks `position: fixed` (its `both` fill-mode
  // leaves a transform applied forever, which makes that ancestor the
  // containing block for fixed descendants instead of the viewport).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const handleGainAccess = async () => {
    if (!selectedLevel || !selectedSemester) return;
    setError('');
    setIsSaving(true);

    try {
      const res = await fetch('/api/user/selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: selectedLevel, semester: selectedSemester }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to save selection.');
        setIsSaving(false);
        return;
      }

      await refreshUser();
      onSuccess();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-y-auto max-h-[90vh] dark:bg-white/[0.04]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 dark:border-white/10">
          <div>
            <h2 className="font-bold text-gray-900 text-base dark:text-gray-100">
              {isChanging ? 'Change Level & Semester' : 'Which level are you in?'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">
              {isChanging
                ? 'This will reset your free course choice.'
                : 'One course is always free.'}
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors ml-3 flex-shrink-0 dark:text-gray-500 dark:hover:text-gray-400 dark:hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Level Grid — 4 columns */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 dark:text-gray-400">Level</p>
            <div className="grid grid-cols-4 gap-2">
              {LEVELS.map((lvl) => (
                <button
                  key={lvl.value}
                  onClick={() => setSelectedLevel(lvl.value)}
                  className={`p-2.5 rounded-xl border-2 text-center transition-all ${
                    selectedLevel === lvl.value
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-500/10'
                      : 'border-gray-200 dark:border-white/10 hover:border-blue-300 hover:bg-gray-50 dark:hover:bg-white/5'
                  }`}
                >
                  <p className={`font-bold text-sm ${selectedLevel === lvl.value ? 'text-blue-700 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'}`}>
                    {lvl.label}
                  </p>
                  <p className={`text-xs ${selectedLevel === lvl.value ? 'text-blue-500 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>
                    {lvl.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Semester Toggle */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 dark:text-gray-400">Semester</p>
            <div className="grid grid-cols-2 gap-2">
              {[1, 2].map((sem) => (
                <button
                  key={sem}
                  onClick={() => setSelectedSemester(sem)}
                  className={`py-2.5 rounded-xl border-2 font-medium text-sm transition-all ${
                    selectedSemester === sem
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400'
                      : 'border-gray-200 dark:border-white/10 hover:border-blue-300 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  Semester {sem}
                </button>
              ))}
            </div>
          </div>

          {/* Free note */}
          <div className="flex items-start gap-2.5 bg-green-50 dark:bg-green-500/10 border border-green-100 dark:border-green-500/20 rounded-xl p-3">
            <BookOpen className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-green-700 dark:text-green-400">
              <span className="font-semibold">One course free.</span>{' '}
              Unlock the rest for just <span className="font-semibold">{priceLabel}</span>.
            </p>
          </div>

          {error && <p className="text-xs text-red-500 dark:text-red-400 text-center">{error}</p>}

          <Button
            className="w-full"
            onClick={handleGainAccess}
            disabled={!selectedLevel || !selectedSemester || isSaving}
          >
            {isSaving ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
            ) : (
              <>Gain Access<ArrowRight className="w-4 h-4 ml-2" /></>
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
