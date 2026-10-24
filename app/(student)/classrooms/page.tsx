'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers';
import { useSubscriptionStore } from '@/lib/store';
import { PaywallModal } from '../courses/components/PaywallModal';
import { Button, Input, Modal, Select } from '@/components/ui';
import { coursesForProgram } from '@/lib/programs';
import { COURSE_ICONS } from '@/lib/utils';
import { classroomErrorMessage, classroomsNotSetUp, type ClassroomRole } from '@/lib/classrooms';
import type { Course } from '@/types';
import { Users, Plus, LogIn, Trophy, BarChart3, Swords, ChevronRight, Crown, Shield, Lock, Gift } from 'lucide-react';

interface MyClassroom {
  id: string;
  name: string;
  role: ClassroomRole;
  courseCode: string;
  courseName: string;
  icon: string | null;
  members: number;
}

export default function ClassroomsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { hasActiveSub } = useSubscriptionStore();
  const [rooms, setRooms] = useState<MyClassroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [notReady, setNotReady] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [name, setName] = useState('');
  const [courseId, setCourseId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [showPaywall, setShowPaywall] = useState(false);

  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  const userId = user?.id;
  const load = useCallback(async () => {
    if (!userId) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from('classroom_members')
      .select('role, classroom:classrooms(id, name, course:courses(course_code, course_name, icon))')
      .eq('user_id', userId)
      .order('joined_at', { ascending: false });
    if (error) {
      setNotReady(classroomsNotSetUp(error));
      setLoading(false);
      return;
    }
    type Row = { role: ClassroomRole; classroom: { id: string; name: string; course: { course_code: string; course_name: string; icon: string | null } | null } | null };
    const rows = ((data ?? []) as unknown as Row[]).filter(r => r.classroom);
    const ids = rows.map(r => r.classroom!.id);
    const counts = new Map<string, number>();
    if (ids.length > 0) {
      const { data: members } = await supabase.from('classroom_members').select('classroom_id').in('classroom_id', ids);
      for (const m of (members ?? []) as { classroom_id: string }[]) counts.set(m.classroom_id, (counts.get(m.classroom_id) ?? 0) + 1);
    }
    setRooms(rows.map(r => ({
      id: r.classroom!.id,
      name: r.classroom!.name,
      role: r.role,
      courseCode: r.classroom!.course?.course_code ?? '',
      courseName: r.classroom!.course?.course_name ?? '',
      icon: r.classroom!.course?.icon ?? null,
      members: counts.get(r.classroom!.id) ?? 1,
    })));
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Courses to pick from when creating: the student's own program, their
  // current level and semester first.
  useEffect(() => {
    if (!showCreate || !user?.program_id || courses.length > 0) return;
    coursesForProgram(createClient(), user.program_id)
      .order('course_code')
      .then(({ data }: { data: Course[] | null }) => {
        const list = (data ?? []).slice().sort((a, b) => {
          const mine = (c: Course) => (c.level === user.selected_level && c.semester === user.selected_semester ? 0 : 1);
          return mine(a) - mine(b) || a.course_code.localeCompare(b.course_code);
        });
        setCourses(list);
        if (list[0]) setCourseId(list[0].id);
      });
  }, [showCreate, user?.program_id, user?.selected_level, user?.selected_semester, courses.length]);

  // Same rule the database enforces (migration 030): your free course, a
  // level you've paid for, or, before you've picked one, your free course.
  const accessFor = (c: Course): 'free' | 'paid' | 'claim' | 'locked' => {
    if (user?.free_course_code && user.free_course_code.toUpperCase() === c.course_code.toUpperCase()) return 'free';
    if (hasActiveSub(c.level, c.semester, user?.program_id)) return 'paid';
    return user?.free_course_code ? 'locked' : 'claim';
  };
  const selectedCourse = courses.find(c => c.id === courseId);
  const selectedAccess = selectedCourse ? accessFor(selectedCourse) : null;

  const handleCreate = async () => {
    setCreating(true);
    setCreateError('');
    const { data, error } = await createClient().rpc('create_classroom', { p_name: name.trim(), p_course_id: courseId });
    setCreating(false);
    if (error || !data) { setCreateError(classroomErrorMessage(error)); return; }
    router.push(`/classrooms/${data as string}?welcome=1`);
  };

  const handleJoin = async () => {
    if (!code.trim()) return;
    setJoining(true);
    setJoinError('');
    const { data, error } = await createClient().rpc('join_classroom', { p_code: code.trim() });
    setJoining(false);
    if (error || !data) {
      // The invite page explains the pay-first / other-programme cases and
      // has the unlock button, so send them there instead of a bare error.
      if (/payment_required|wrong_program/.test(error?.message ?? '')) { router.push(`/join/${code.trim().toUpperCase()}`); return; }
      setJoinError(classroomErrorMessage(error));
      return;
    }
    router.push(`/classrooms/${data as string}`);
  };

  if (notReady) {
    return (
      <div className="max-w-xl mx-auto text-center py-16">
        <div className="w-14 h-14 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center mx-auto mb-4 dark:bg-blue-500/15 dark:text-blue-400">
          <Users className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Classrooms are almost here</h1>
        <p className="text-gray-500 mt-2 dark:text-gray-400">We&rsquo;re finishing the setup. Check back soon to study with your classmates.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Classrooms</h1>
        <p className="text-gray-600 dark:text-gray-400">Study with your classmates: a weekly leaderboard, shared progress and the topics your class finds hardest.</p>
      </div>

      {/* Create / join */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => { setShowCreate(true); setCreateError(''); }}
          className="flex items-center gap-3 p-4 rounded-2xl bg-blue-600 text-white text-left shadow-sm hover:bg-blue-700 active:scale-[0.99] transition-all"
        >
          <span className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0"><Plus className="w-5 h-5" /></span>
          <span className="min-w-0">
            <span className="block font-semibold">Create a classroom</span>
            <span className="block text-sm text-blue-100">For your course or study group</span>
          </span>
        </button>
        <div className="p-4 rounded-2xl bg-white border border-gray-200 shadow-sm dark:bg-white/[0.04] dark:border-white/10">
          <p className="font-semibold text-gray-900 text-sm mb-2 dark:text-gray-100">Have a code?</p>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={e => { setCode(e.target.value.toUpperCase()); setJoinError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handleJoin(); }}
              placeholder="e.g. K7M2QX"
              maxLength={6}
              autoCapitalize="characters"
              className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-gray-300 text-sm font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-white/5 dark:border-white/15 dark:text-gray-100"
            />
            <Button onClick={handleJoin} isLoading={joining} disabled={code.trim().length < 6}>
              <LogIn className="w-4 h-4 mr-1.5" />Join
            </Button>
          </div>
          {joinError && <p className="text-xs text-red-600 mt-2 dark:text-red-400">{joinError}</p>}
        </div>
      </div>

      {/* My classrooms */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2].map(i => <div key={i} className="h-28 rounded-2xl bg-white border border-gray-200 animate-pulse dark:bg-white/[0.04] dark:border-white/10" />)}
        </div>
      ) : rooms.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 p-6 sm:p-8 text-center dark:border-white/15">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Study together, pass together</h2>
          <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">Create a classroom and share the link in your class WhatsApp group.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5 text-left">
            {[
              { icon: Trophy, title: 'Weekly leaderboard', text: 'See who practised most this week' },
              { icon: BarChart3, title: 'Class weak spots', text: 'The topics your class gets wrong most' },
              { icon: Swords, title: 'Battles, coming soon', text: 'Live quizzes against your classmates' },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-white/[0.03]">
                <Icon className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5 dark:text-blue-400" />
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <h2 className="font-semibold text-gray-900 mb-3 dark:text-gray-100">Your classrooms</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rooms.map(room => (
              <Link
                key={room.id}
                href={`/classrooms/${room.id}`}
                className="group flex flex-col gap-3 p-4 rounded-2xl bg-white border border-gray-200 shadow-sm hover:border-blue-300 hover:shadow-md active:scale-[0.99] transition-all dark:bg-white/[0.04] dark:border-white/10 dark:hover:border-blue-500/40"
              >
                <div className="flex items-start gap-3">
                  <span className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center text-xl flex-shrink-0 dark:bg-blue-500/15">
                    {room.icon || COURSE_ICONS[room.courseCode] || '📚'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900 truncate dark:text-gray-100">{room.name}</p>
                    <p className="text-xs text-gray-500 truncate dark:text-gray-400">{room.courseCode} · {room.courseName}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-blue-500 flex-shrink-0 dark:text-gray-600" />
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{room.members} {room.members === 1 ? 'member' : 'members'}</span>
                  {room.role !== 'member' && (
                    <span className="flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400">
                      {room.role === 'owner' ? <Crown className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                      {room.role === 'owner' ? 'Owner' : 'Leader'}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <Modal isOpen={showCreate} onClose={() => !creating && setShowCreate(false)} title="Create a classroom" size="md">
        <div className="space-y-4">
          <Input
            label="Classroom name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. DCIT 301 study group"
            maxLength={80}
          />
          <Select label="Course" value={courseId} onChange={e => setCourseId(e.target.value)}>
            {courses.length === 0 && <option value="">Loading courses…</option>}
            {courses.map(c => {
              const access = accessFor(c);
              return (
                <option key={c.id} value={c.id}>
                  {access === 'locked' ? '🔒 ' : ''}{c.course_code} — {c.course_name}{access === 'free' ? ' (your free course)' : ''}
                </option>
              );
            })}
          </Select>
          {selectedAccess === 'claim' && selectedCourse && (
            <p className="flex items-start gap-2 text-xs rounded-xl px-3 py-2.5 bg-green-50 text-green-800 dark:bg-green-500/10 dark:text-green-300">
              <Gift className="w-4 h-4 flex-shrink-0" />
              <span>{selectedCourse.course_code} becomes your free course. Classrooms for other courses need an unlock.</span>
            </p>
          )}
          {selectedAccess === 'locked' && selectedCourse && (
            <p className="flex items-start gap-2 text-xs rounded-xl px-3 py-2.5 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-300">
              <Lock className="w-4 h-4 flex-shrink-0" />
              <span>Unlock Level {selectedCourse.level}, Semester {selectedCourse.semester} to start a {selectedCourse.course_code} classroom. Your free course is {user?.free_course_code}.</span>
            </p>
          )}
          {(selectedAccess === 'free' || selectedAccess === 'paid' || !selectedAccess) && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Everyone in the classroom practises this course together. You&rsquo;ll get a link and a code to share.
            </p>
          )}
          {createError && <p className="text-sm text-red-600 dark:text-red-400">{createError}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</Button>
            {selectedAccess === 'locked' ? (
              <Button onClick={() => setShowPaywall(true)}><Lock className="w-4 h-4 mr-1.5" />Unlock</Button>
            ) : (
              <Button onClick={handleCreate} isLoading={creating} disabled={name.trim().length < 3 || !courseId}>Create</Button>
            )}
          </div>
        </div>
      </Modal>

      {showPaywall && selectedCourse && (
        <PaywallModal
          courseName={selectedCourse.course_name}
          courseCode={selectedCourse.course_code}
          totalCourses={0}
          level={selectedCourse.level}
          semester={selectedCourse.semester}
          heading={`Unlock ${selectedCourse.course_code}`}
          blurb={`One payment opens every Level ${selectedCourse.level} course in your programme for Semester ${selectedCourse.semester}, so you can start classrooms for any of them.`}
          onClose={() => setShowPaywall(false)}
          onSuccess={() => setShowPaywall(false)}
        />
      )}
    </div>
  );
}
