import type { createClient } from '@/lib/supabase/server';

type UserClient = Awaited<ReturnType<typeof createClient>>;

export type TutorAction = 'explain_mistakes' | 'quiz_weak' | 'revision_plan';
export const TUTOR_ACTIONS: TutorAction[] = ['explain_mistakes', 'quiz_weak', 'revision_plan'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface QuestionOption { id: string; text: string }

function answerText(ids: unknown, options: QuestionOption[] | null): string {
  const list = Array.isArray(ids) ? ids.map(String) : [];
  if (list.length === 0) return '(no answer)';
  if (!options?.length) return list.join(', ');
  return list.map(id => options.find(o => o.id === id)?.text ?? id).join('; ');
}

const ACTION_INSTRUCTIONS: Record<TutorAction, string> = {
  explain_mistakes:
    "The student wants to understand the mistakes from their latest test (listed above). For each wrong answer: name the concept it tests, explain why their choice was wrong, why the correct answer is right, and a quick way to remember it. If several mistakes share a concept, group them. Finish with 2 short check-your-understanding questions (answers hidden at the end). If there is no test or no wrong answers listed, say so warmly and offer a quiz instead.",
  quiz_weak:
    "Run a short interactive quiz on the student's weakest topics listed above (if none are listed, use the course's syllabus topics). Ask ONE multiple-choice question at a time with options A–D, then STOP and wait for their answer. After each answer: say right or wrong, explain in 2–3 sentences, then ask the next question. Keep a running score (e.g. 3/4). Aim for 5 questions, then summarise what to revise. Do not reveal answers before the student replies.",
  revision_plan:
    "Make a realistic day-by-day revision plan from today until the exam date above (7 days if no date is set), about 1–2 hours a day. Put the weakest topics first and repeat them, and use the platform's own practice modes by name: Quick Practice, Mock Exam (timed), My Mistakes, and Due for Review. Present it as a markdown table: Day | Focus | Tasks. End with 3 short tips for the final day before the exam.",
};

/**
 * Builds a private "what we know about this student" note for the tutor,
 * from the student's own data (their RLS-scoped client): the selected
 * course and its syllabus, their weakest topics from practice history,
 * their exam date, and — for "explain my mistakes" — the questions they
 * got wrong in their latest test in that course.
 */
export async function buildTutorContext(
  supabase: UserClient,
  userId: string,
  courseId: unknown,
  action: TutorAction | null
): Promise<string> {
  const parts: string[] = [];
  const today = new Date();
  parts.push(`Today's date: ${today.toISOString().slice(0, 10)}.`);

  let course: { id: string; course_code: string; course_name: string; level: number; semester: number } | null = null;
  if (typeof courseId === 'string' && UUID_RE.test(courseId)) {
    const { data } = await supabase
      .from('courses')
      .select('id, course_code, course_name, level, semester')
      .eq('id', courseId)
      .maybeSingle();
    course = data;
  }

  if (course) {
    parts.push(`Course the student is studying: ${course.course_code} — ${course.course_name} (Level ${course.level}, Semester ${course.semester}).`);
    const { data: topics } = await supabase
      .from('topics')
      .select('topic_name')
      .eq('course_id', course.id)
      .order('order_index')
      .limit(60);
    const names = [...new Set(((topics ?? []) as { topic_name: string }[]).map(t => t.topic_name.trim()))];
    if (names.length) parts.push(`Topics in this course's syllabus: ${names.join('; ')}.`);
  }

  const [{ data: weak }, { data: profile }] = await Promise.all([
    supabase.rpc('get_weak_topics', { p_user_id: userId, p_limit: 10 }),
    supabase.from('users').select('exam_date').eq('id', userId).maybeSingle(),
  ]);

  const weakList = ((weak ?? []) as { topic_name: string; course_code: string; accuracy: number }[])
    .filter(w => !course || w.course_code === course.course_code)
    .slice(0, 6);
  if (weakList.length) {
    parts.push(`The student's weakest topics from their practice history (accuracy): ${weakList
      .map(w => `${w.topic_name}${course ? '' : ` [${w.course_code}]`} (${Math.round(Number(w.accuracy))}%)`)
      .join('; ')}.`);
  } else {
    parts.push(`No weak-topic data yet${course ? ' for this course' : ''} (they haven't practised enough questions).`);
  }

  const examDate = (profile as { exam_date: string | null } | null)?.exam_date;
  if (examDate) {
    const days = Math.ceil((new Date(`${examDate}T00:00:00`).getTime() - new Date(today.toDateString()).getTime()) / 86400000);
    parts.push(`Their exam date: ${examDate} (${days >= 0 ? `${days} day${days === 1 ? '' : 's'} away` : 'already passed'}).`);
  }

  if (action === 'explain_mistakes') {
    if (!course) {
      parts.push('No course is selected, so their test mistakes are unavailable — ask them to pick a course first.');
    } else {
      const { data: test } = await supabase
        .from('tests')
        .select('id, percentage, test_type, created_at')
        .eq('user_id', userId)
        .eq('course_id', course.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!test) {
        parts.push(`They have not taken a test in ${course.course_code} yet.`);
      } else {
        const { data: wrong } = await supabase
          .from('test_answers')
          .select('selected_answer, question:questions(question_text, question_type, options, correct_answers, explanation)')
          .eq('test_id', test.id)
          .eq('is_correct', false)
          .limit(8);
        const rows = (wrong ?? []) as unknown as {
          selected_answer: unknown;
          question: { question_text: string; question_type: string; options: QuestionOption[] | null; correct_answers: unknown; explanation: string | null } | null;
        }[];
        parts.push(`Their latest ${test.test_type === 'exam_simulation' ? 'mock exam' : 'practice test'} in ${course.course_code} (${String(test.created_at).slice(0, 10)}) scored ${Math.round(Number(test.percentage))}%.`);
        if (rows.length === 0) {
          parts.push('They got every question right in that test.');
        } else {
          parts.push('Questions they got wrong in that test:');
          rows.forEach((r, i) => {
            const q = r.question;
            if (!q) return;
            const opts = q.options?.length ? ` Options: ${q.options.map(o => o.text).join(' | ')}.` : '';
            parts.push(`${i + 1}. ${q.question_text.slice(0, 600)}${opts} Their answer: ${answerText(r.selected_answer, q.options)}. Correct answer: ${answerText(q.correct_answers, q.options)}.${q.explanation ? ` Stored explanation: ${q.explanation.slice(0, 400)}` : ''}`);
          });
        }
      }
    }
  }

  let note = `Private notes about this student (use them to personalise your help; don't recite them back unprompted):\n${parts.join('\n')}`;
  if (action) note += `\n\nTASK FOR THIS REPLY: ${ACTION_INSTRUCTIONS[action]}`;
  return note;
}
