'use client';

import { useState } from 'react';
import { useAuth } from '@/components/providers';
import { Button } from '@/components/ui';
import { GraduationCap, ArrowRight, BookOpen, Loader2 } from 'lucide-react';

const LEVELS = [
  { value: 100, label: 'Level 100', desc: 'First Year' },
  { value: 200, label: 'Level 200', desc: 'Second Year' },
  { value: 300, label: 'Level 300', desc: 'Third Year' },
  { value: 400, label: 'Level 400', desc: 'Fourth Year' },
] as const;

interface Props {
  onSuccess: () => void;
  isChanging?: boolean;
}

export function LevelSemesterModal({ onSuccess, isChanging = false }: Props) {
  const { user, refreshUser } = useAuth();
  const [selectedLevel, setSelectedLevel] = useState<number | null>(
    user?.selected_level ?? null
  );
  const [selectedSemester, setSelectedSemester] = useState<number | null>(
    user?.selected_semester ?? null
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <GraduationCap className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">
            {isChanging ? 'Change Your Level & Semester' : 'Which level are you in?'}
          </h2>
          <p className="text-gray-500 mt-2 text-sm">
            {isChanging
              ? 'Changing your selection will reset your free course choice.'
              : 'We\'ll load the right courses for you. One course is always free.'}
          </p>
        </div>

        {/* Level Grid */}
        <div className="mb-6">
          <p className="text-sm font-medium text-gray-700 mb-3">Select your level</p>
          <div className="grid grid-cols-2 gap-3">
            {LEVELS.map((lvl) => (
              <button
                key={lvl.value}
                onClick={() => setSelectedLevel(lvl.value)}
                className={`p-4 rounded-2xl border-2 text-left transition-all ${
                  selectedLevel === lvl.value
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                }`}
              >
                <p className={`font-semibold ${selectedLevel === lvl.value ? 'text-blue-700' : 'text-gray-900'}`}>
                  {lvl.label}
                </p>
                <p className={`text-sm ${selectedLevel === lvl.value ? 'text-blue-500' : 'text-gray-500'}`}>
                  {lvl.desc}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Semester Toggle */}
        <div className="mb-8">
          <p className="text-sm font-medium text-gray-700 mb-3">Select your semester</p>
          <div className="grid grid-cols-2 gap-3">
            {[1, 2].map((sem) => (
              <button
                key={sem}
                onClick={() => setSelectedSemester(sem)}
                className={`p-4 rounded-2xl border-2 font-medium transition-all ${
                  selectedSemester === sem
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:border-blue-300 text-gray-700'
                }`}
              >
                Semester {sem}
              </button>
            ))}
          </div>
        </div>

        {/* Free tier note */}
        <div className="flex items-start gap-3 bg-green-50 border border-green-100 rounded-xl p-4 mb-6">
          <BookOpen className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-green-800">One course is always free</p>
            <p className="text-xs text-green-600 mt-0.5">
              Pick any one course to practise without paying. Unlock the rest for just GHC 1.
            </p>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-500 mb-4 text-center">{error}</p>
        )}

        <Button
          className="w-full"
          size="lg"
          onClick={handleGainAccess}
          disabled={!selectedLevel || !selectedSemester || isSaving}
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              Gain Access
              <ArrowRight className="w-5 h-5 ml-2" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
