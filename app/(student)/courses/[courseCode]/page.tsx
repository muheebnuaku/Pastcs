'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers';
import { useSubscriptionStore } from '@/lib/store';
import { usePricing } from '@/lib/hooks/usePricing';
import { Card, CardContent, Button } from '@/components/ui';
import { COURSE_ICONS, QUESTIONS_PER_PRACTICE, QUESTIONS_PER_EXAM, EXAM_DURATION_MINUTES, decodeRouteParam, courseCodeSlug } from '@/lib/utils';
import { PaywallModal } from '../components/PaywallModal';
import { courseCountForProgram } from '@/lib/programs';
import type { Course, Topic } from '@/types';
import {
  ArrowLeft,
  BookOpen,
  Target,
  FileQuestion,
  Zap,
  Lock,
  RotateCcw,
  CalendarClock,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';

export default function CourseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { hasActiveSub } = useSubscriptionStore();

  const courseCode = decodeRouteParam(params.courseCode as string).toUpperCase();
  const [course, setCourse] = useState<Course | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicIdGroups, setTopicIdGroups] = useState<string[][]>([]); // all IDs per unique topic name
  const [allLevelCourses, setAllLevelCourses] = useState(0);
  const [showPaywall, setShowPaywall] = useState(false);

  const isPaid = hasActiveSub(user?.selected_level, user?.selected_semester, user?.program_id);
  const isFree = course?.course_code === user?.free_course_code;
  const { label: priceLabel } = usePricing(user?.selected_level, user?.program_id);
  const hasAccess = isPaid || isFree;

  useEffect(() => {
    let cancelled = false;
    const fetchCourseData = async () => {
      const supabase = createClient();

      const { data: courseData } = await supabase
        .from('courses')
        .select('*')
        // Case-insensitive: a course_code saved with any casing from the
        // admin form (e.g. "Dcit201") would never match the uppercased
        // slug from the URL under an exact eq() match.
        .ilike('course_code', courseCode)
        .single();

      if (!cancelled && courseData) {
        setCourse(courseData);

        const { data: topicsData } = await supabase
          .from('topics')
          .select('*')
          .eq('course_id', courseData.id)
          .order('order_index');

        if (!cancelled && topicsData) {
          // Group duplicate topic rows by name, collecting all their IDs
          const seen = new Map<string, { topic: Topic; ids: string[] }>();
          for (const t of topicsData as Topic[]) {
            const key = t.topic_name.trim().toLowerCase();
            if (!seen.has(key)) {
              seen.set(key, { topic: t, ids: [t.id] });
            } else {
              seen.get(key)!.ids.push(t.id);
            }
          }
          const groups = Array.from(seen.values());
          setTopics(groups.map(g => g.topic));
          setTopicIdGroups(groups.map(g => g.ids));
        }
      }
    };

    fetchCourseData();
    return () => { cancelled = true; };
  }, [courseCode]);

  useEffect(() => {
    if (!course?.id || !user?.selected_level || !user?.selected_semester || !user?.program_id) return;
    const fetchCount = async () => {
      const supabase = createClient();
      const { count } = await courseCountForProgram(supabase, user.program_id!)
        .eq('level', user.selected_level!)
        .eq('semester', user.selected_semester!);
      setAllLevelCourses(count ?? 0);
    };
    fetchCount();
  }, [course?.id, user?.selected_level, user?.selected_semester, user?.program_id]);

  if (!course) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Course not found</h2>
        <Link href="/courses" className="text-blue-600 hover:underline mt-2 inline-block">
          Back to courses
        </Link>
      </div>
    );
  }

  // No free course selected yet — send back to courses to pick
  if (!hasAccess && !user?.free_course_code) {
    router.push('/courses');
    return null;
  }

  const slug = courseCodeSlug(course.course_code);
  const icon = course.icon || COURSE_ICONS[course.course_code] || '📚';

  const header = (
    <div className="bg-gradient-to-br from-blue-600 to-purple-600 rounded-2xl p-5 sm:p-8 text-white">
      <div className="flex items-start gap-4 sm:gap-6">
        <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center text-3xl sm:text-4xl bg-white/20 flex-shrink-0">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl sm:text-3xl font-bold break-words">{course.course_code}</h1>
          <p className="text-blue-100 sm:text-lg">{course.course_name}</p>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className="inline-flex items-center gap-1.5 bg-white/20 rounded-full px-3 py-1 text-xs sm:text-sm font-medium">
              <FileQuestion className="w-3.5 h-3.5" />
              {course.total_questions} questions
            </span>
            <span className="inline-flex items-center gap-1.5 bg-white/20 rounded-full px-3 py-1 text-xs sm:text-sm font-medium">
              <BookOpen className="w-3.5 h-3.5" />
              {topics.length} topics
            </span>
            {!hasAccess && (
              <span className="inline-flex items-center gap-1.5 bg-black/20 rounded-full px-3 py-1 text-xs sm:text-sm font-medium">
                <Lock className="w-3.5 h-3.5" />
                Locked
              </span>
            )}
          </div>
        </div>
      </div>
      {hasAccess && course.description && (
        <p className="text-blue-100/90 text-sm mt-4">{course.description}</p>
      )}
    </div>
  );

  const backLink = (
    <Link href="/courses" className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">
      <ArrowLeft className="w-4 h-4 mr-1.5" />
      All courses
    </Link>
  );

  const paywall = showPaywall && (
    <PaywallModal
      courseName={course.course_name}
      courseCode={course.course_code}
      totalCourses={allLevelCourses}
      onClose={() => setShowPaywall(false)}
      onSuccess={() => {
        setShowPaywall(false);
        router.refresh();
      }}
    />
  );

  // Locked course — sell what's behind the lock instead of just blurring it.
  if (!hasAccess && user?.free_course_code) {
    const perks = [
      `${course.total_questions} practice questions across ${topics.length} topics`,
      `Timed mock exams — ${QUESTIONS_PER_EXAM} questions in ${EXAM_DURATION_MINUTES} minutes`,
      'Mistake review and spaced repetition so answers stick',
      allLevelCourses > 1
        ? `Every other course this semester too — ${allLevelCourses} in total`
        : 'Access for the whole semester',
    ];
    return (
      <div className="space-y-5 animate-fade-in">
        {backLink}
        {header}

        <Card>
          <CardContent className="p-5 sm:p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Unlock {course.course_code}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              You&rsquo;ve used your free course. One payment opens everything for this semester.
            </p>
            <ul className="mt-4 space-y-2.5">
              {perks.map(perk => (
                <li key={perk} className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                  <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                  <span>{perk}</span>
                </li>
              ))}
            </ul>
            <Button size="lg" onClick={() => setShowPaywall(true)} className="w-full sm:w-auto mt-5">
              <Lock className="w-4 h-4 mr-2" />
              Unlock all courses — {priceLabel}
            </Button>
          </CardContent>
        </Card>

        {paywall}
      </div>
    );
  }

  // Full class strings (not interpolated fragments) so Tailwind picks them up.
  const tiles = [
    { href: `/practice/${slug}?mode=quick`, icon: Zap, title: 'Quick Practice', sub: `${QUESTIONS_PER_PRACTICE} questions · no timer`, iconBox: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400', hover: 'hover:border-blue-300 dark:hover:border-blue-500/40' },
    { href: `/exam/${slug}`, icon: Target, title: 'Mock Exam', sub: `${QUESTIONS_PER_EXAM} questions · ${EXAM_DURATION_MINUTES} min`, iconBox: 'bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400', hover: 'hover:border-purple-300 dark:hover:border-purple-500/40' },
    { href: `/practice/${slug}?mode=mistakes`, icon: RotateCcw, title: 'My Mistakes', sub: 'Redo what you got wrong', iconBox: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400', hover: 'hover:border-amber-300 dark:hover:border-amber-500/40' },
    { href: `/practice/${slug}?mode=due`, icon: CalendarClock, title: 'Due for Review', sub: 'Lock in what you learned', iconBox: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400', hover: 'hover:border-violet-300 dark:hover:border-violet-500/40' },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {backLink}

      {isFree && !isPaid && allLevelCourses > 1 && (
        <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-blue-800 dark:text-blue-300">
            <span className="font-semibold">This is your free course.</span>{' '}
            Unlock the other {allLevelCourses - 1} for {priceLabel} this semester.
          </p>
          <Button size="sm" onClick={() => setShowPaywall(true)} className="w-full sm:w-auto flex-shrink-0">
            Unlock all
          </Button>
        </div>
      )}

      {header}

      <section>
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">How do you want to study?</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {tiles.map(({ href, icon: Icon, title, sub, iconBox, hover }) => (
            <Link
              key={title}
              href={href}
              className={`group flex flex-col gap-3 p-4 rounded-2xl bg-white border border-gray-200 shadow-sm hover:shadow-md active:scale-[0.98] transition-all dark:bg-white/[0.04] dark:border-white/10 ${hover}`}
            >
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${iconBox}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm sm:text-base leading-tight">{title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{sub}</p>
              </div>
              <span className="inline-flex items-center text-xs font-semibold text-gray-400 group-hover:text-gray-700 dark:text-gray-500 dark:group-hover:text-gray-200 transition-colors">
                Start <ChevronRight className="w-3.5 h-3.5 ml-0.5 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Practice by topic</h2>
        {topics.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {topics.map((topic, idx) => (
              <Link
                key={topic.id}
                href={`/practice/${slug}?topic=${(topicIdGroups[idx] ?? [topic.id]).join(',')}`}
                className="group flex items-center gap-3 p-4 rounded-xl bg-white border border-gray-200 hover:border-blue-300 hover:shadow-sm active:scale-[0.99] transition-all dark:bg-white/[0.04] dark:border-white/10 dark:hover:border-blue-500/40"
              >
                <span className="w-8 h-8 rounded-lg bg-gray-100 text-gray-600 text-sm font-semibold flex items-center justify-center flex-shrink-0 dark:bg-white/10 dark:text-gray-300">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-gray-900 dark:text-gray-100 text-sm sm:text-base">{topic.topic_name}</h3>
                  {topic.description && (
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-1 dark:text-gray-400">{topic.description}</p>
                  )}
                </div>
                <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-blue-500 flex-shrink-0 dark:text-gray-600 transition-colors" />
              </Link>
            ))}
          </div>
        ) : (
          <Card>
            <p className="text-gray-500 text-center py-8 text-sm dark:text-gray-400">
              Topics for this course are coming soon.
            </p>
          </Card>
        )}
      </section>

      {paywall}
    </div>
  );
}
