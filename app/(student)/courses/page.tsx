'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers';
import { useSubscriptionStore } from '@/lib/store';
import { usePricing } from '@/lib/hooks/usePricing';
import { Button, Modal } from '@/components/ui';
import { COURSE_ICONS, courseCodeSlug } from '@/lib/utils';
import { LevelSemesterModal } from './components/LevelSemesterModal';
import { PaywallModal } from './components/PaywallModal';
import { coursesForProgram } from '@/lib/programs';
import type { Course } from '@/types';
import {
  ArrowRight,
  Lock,
  CheckCircle,
  RefreshCw,
  GraduationCap,
  Sparkles,
  Zap,
  ShieldCheck,
  Gift,
  ChevronRight,
} from 'lucide-react';

export default function CoursesPage() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const { hasActiveSub } = useSubscriptionStore();

  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingFreeCourse, setSettingFreeCourse] = useState<string | null>(null);
  const [confirmFreeCourse, setConfirmFreeCourse] = useState<Course | null>(null);
  const [freeCourseError, setFreeCourseError] = useState<string | null>(null);
  const [paywallCourse, setPaywallCourse] = useState<Course | null>(null);
  const [showLevelModal, setShowLevelModal] = useState(false);

  const level = user?.selected_level;
  const semester = user?.selected_semester;
  const freeCourseCode = user?.free_course_code;
  const isPaid = hasActiveSub(level, semester, user?.program_id);
  const { label: priceLabel } = usePricing(level, user?.program_id);
  const lockedCount = !isPaid && freeCourseCode
    ? courses.filter(c => c.course_code !== freeCourseCode).length
    : 0;

  const fetchCourses = async () => {
    if (!level || !semester || !user?.program_id) return;
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await coursesForProgram(supabase, user.program_id)
        .eq('level', level)
        .eq('semester', semester)
        .order('course_code');
      if (fetchError) throw fetchError;
      setCourses(data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load courses.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    if (!user.selected_level) {
      setShowLevelModal(true);
      setIsLoading(false);
    } else {
      fetchCourses();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.selected_level, user?.selected_semester, user?.program_id]);

  const handleSelectFreeCourse = async (courseCode: string) => {
    setSettingFreeCourse(courseCode);
    setFreeCourseError(null);
    try {
      const res = await fetch('/api/user/free-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseCode }),
      });
      if (res.ok) {
        await refreshUser();
        router.push(`/courses/${courseCodeSlug(courseCode)}`);
      } else {
        const data = await res.json().catch(() => ({}));
        setFreeCourseError(data.error || 'Could not set your free course. Please try again.');
      }
    } catch {
      setFreeCourseError('Network error — please try again.');
    } finally {
      setSettingFreeCourse(null);
    }
  };

  if (!user) return null;

  const totalQuestions = courses.reduce((sum, c) => sum + (c.total_questions ?? 0), 0);
  const openPaywall = () => setPaywallCourse(courses.find(c => c.course_code !== freeCourseCode) ?? null);

  const iconTile = (course: Course, dim = false) => (
    <div
      className={`w-11 h-11 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 ${dim ? 'grayscale opacity-50' : ''}`}
      style={{ backgroundColor: `${course.color}20` }}
    >
      {course.icon || COURSE_ICONS[course.course_code] || '📚'}
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in">
      {showLevelModal && (
        <LevelSemesterModal
          isChanging={!!user?.selected_level}
          onClose={() => setShowLevelModal(false)}
          onSuccess={() => {
            setShowLevelModal(false);
            fetchCourses();
          }}
        />
      )}

      {paywallCourse && (
        <PaywallModal
          courseName={paywallCourse.course_name}
          courseCode={paywallCourse.course_code}
          totalCourses={courses.length}
          onClose={() => setPaywallCourse(null)}
          onSuccess={() => setPaywallCourse(null)}
        />
      )}

      {/* The free pick is permanent (the API refuses to change it), so a
          single stray tap on a card must not commit it. */}
      <Modal
        isOpen={!!confirmFreeCourse}
        onClose={() => { if (!settingFreeCourse) { setConfirmFreeCourse(null); setFreeCourseError(null); } }}
        title="Start your free course"
        size="sm"
      >
        {confirmFreeCourse && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {iconTile(confirmFreeCourse)}
              <div className="min-w-0">
                <p className="font-bold text-gray-900 dark:text-gray-100">{confirmFreeCourse.course_code}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{confirmFreeCourse.course_name}</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              This will be your free course for good — you can&rsquo;t swap it for another one later.
            </p>
            {freeCourseError && (
              <p className="text-sm text-red-600 dark:text-red-400">{freeCourseError}</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => { setConfirmFreeCourse(null); setFreeCourseError(null); }} disabled={!!settingFreeCourse}>
                Pick another
              </Button>
              <Button
                onClick={() => handleSelectFreeCourse(confirmFreeCourse.course_code)}
                isLoading={settingFreeCourse === confirmFreeCourse.course_code}
                className="bg-green-600 hover:bg-green-700"
              >
                Start free
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Courses</h1>
        {level && semester ? (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-gray-500 text-sm dark:text-gray-400">Level {level} · Semester {semester}</span>
            <button onClick={() => setShowLevelModal(true)} className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">
              Change
            </button>
          </div>
        ) : (
          <p className="text-gray-500 text-sm dark:text-gray-400">Select your level to get started</p>
        )}
      </div>

      {/* Free-pick banner */}
      {level && !isPaid && !freeCourseCode && courses.length > 0 && (
        <div className="bg-gradient-to-br from-green-600 to-emerald-600 rounded-2xl p-5 text-white">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <Gift className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="font-bold">Pick one course to try free</p>
              <p className="text-sm text-green-50/90 mt-0.5">
                No payment needed. Choose the course you need most — you can unlock all {courses.length} courses
                ({totalQuestions}+ questions) later for <strong className="text-white">{priceLabel}</strong>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Locked-courses upgrade banner */}
      {level && !isPaid && freeCourseCode && lockedCount > 0 && (
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 sm:p-5 dark:border-blue-500/20 dark:from-blue-500/10 dark:to-indigo-500/10">
          <p className="font-semibold text-gray-900 dark:text-gray-100">
            Unlock {lockedCount} more course{lockedCount > 1 ? 's' : ''} for {priceLabel}
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-2">
            {[
              { icon: Zap, text: `All ${courses.length} courses this semester` },
              { icon: ShieldCheck, text: 'Timed mock exams' },
              { icon: Sparkles, text: 'AI explanations' },
            ].map(({ icon: Icon, text }) => (
              <span key={text} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                <Icon className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                {text}
              </span>
            ))}
          </div>
          <Button onClick={openPaywall} className="w-full sm:w-auto mt-4">
            <Sparkles className="w-4 h-4 mr-2" />
            Unlock all — {priceLabel}
          </Button>
        </div>
      )}

      {/* Full-access banner */}
      {isPaid && (
        <div className="bg-green-50 dark:bg-green-500/10 border border-green-100 dark:border-green-500/20 rounded-2xl p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
          <p className="text-sm font-medium text-green-800 dark:text-green-400">
            Full access — all {courses.length} courses unlocked this semester
          </p>
        </div>
      )}

      {/* No level selected */}
      {!level && !showLevelModal && (
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-500/15 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <GraduationCap className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 dark:text-gray-100">Select your level to begin</h2>
          <Button onClick={() => setShowLevelModal(true)}>
            Get started <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-200 p-4 animate-pulse dark:bg-white/[0.04] dark:border-white/10">
              <div className="w-11 h-11 bg-gray-200 rounded-xl mb-3 dark:bg-white/15" />
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-2 dark:bg-white/15" />
              <div className="h-3 bg-gray-100 rounded w-3/4 dark:bg-white/10" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <div className="text-center py-12">
          <p className="text-red-500 dark:text-red-400 mb-4">{error}</p>
          <Button onClick={fetchCourses}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      )}

      {/* Course Grid */}
      {!isLoading && !error && courses.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {courses.map((course) => {
            const isFreeCourse = course.course_code === freeCourseCode;
            const isLocked = !isPaid && !isFreeCourse && !!freeCourseCode;
            const isPickable = !isPaid && !freeCourseCode;

            const body = (
              <>
                <div className="flex items-start justify-between gap-2">
                  {iconTile(course, isLocked)}
                  {isLocked && (
                    <span className="flex items-center gap-1 bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full text-[11px] font-medium dark:bg-white/10 dark:text-gray-400">
                      <Lock className="w-3 h-3" /> Locked
                    </span>
                  )}
                  {isFreeCourse && !isPaid && (
                    <span className="bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                      Free
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className={`font-bold text-sm sm:text-base break-words ${isLocked ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>
                    {course.course_code}
                  </h2>
                  <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 leading-snug line-clamp-2 mt-0.5">{course.course_name}</p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5">{course.total_questions ?? 0} questions</p>
                </div>
                <div className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs sm:text-sm font-semibold transition-colors ${
                  isLocked
                    ? 'bg-blue-50 text-blue-700 group-hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-400 dark:group-hover:bg-blue-500/15'
                    : isPickable
                      ? 'bg-green-600 text-white group-hover:bg-green-700'
                      : 'bg-blue-600 text-white group-hover:bg-blue-700'
                }`}>
                  {isLocked ? (<><Lock className="w-3.5 h-3.5" /> Unlock</>)
                    : isPickable ? (<><Gift className="w-3.5 h-3.5" /> Try free</>)
                    : (<>Open <ChevronRight className="w-4 h-4" /></>)}
                </div>
              </>
            );

            const cardClass = `group h-full w-full text-left flex flex-col gap-3 p-3.5 sm:p-4 rounded-2xl border shadow-sm hover:shadow-md active:scale-[0.98] transition-all ${
              isLocked
                ? 'border-dashed border-gray-300 bg-white/60 dark:border-white/15 dark:bg-white/[0.02]'
                : 'border-gray-200 bg-white hover:border-blue-300 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-blue-500/40'
            }`;

            if (isLocked) {
              return <button key={course.id} className={cardClass} onClick={() => setPaywallCourse(course)}>{body}</button>;
            }
            if (isPickable) {
              return <button key={course.id} className={cardClass} onClick={() => setConfirmFreeCourse(course)}>{body}</button>;
            }
            return (
              <Link key={course.id} href={`/courses/${courseCodeSlug(course.course_code)}`} className={cardClass}>
                {body}
              </Link>
            );
          })}
        </div>
      )}

      {!isLoading && !error && level && courses.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">No courses available for Level {level} Semester {semester} yet.</p>
        </div>
      )}
    </div>
  );
}
