import { requireUser, serviceClient } from '@/lib/apiAuth';
import { fillAnswerCorrect, normAnswer } from '@/lib/checkAnswer';

// Saves a finished practice session or mock exam. The browser sends only
// what the student picked; the score, the answers' marks, XP and the
// streak are all worked out by record_test (migration 034), so a score
// can't be made up from the console. This route's one job beyond that is
// the AI check for typed answers that don't match word for word.

// The AI checks wait on OpenAI; the save must never wait on them past
// this, or Vercel cuts the whole request off and the student loses the
// session. Answers still unchecked by then are marked as typed.
export const maxDuration = 60;
const AI_BUDGET_MS = 8000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AI_CHECKS = 20;

interface SubmittedAnswer {
  question_id: string;
  selected: string[];
  confidence: 'sure' | 'unsure' | null;
}

const ERRORS: Record<string, string> = {
  payment_required: 'This course is locked. Unlock it to save your results.',
  bad_questions: 'Some of these questions have changed since you started. Please start a new session.',
  topic_locked: 'Some of these questions are in topics your free course doesn’t include. Unlock all courses to save them.',
};

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const { courseId, topicId, testType, timeTaken } = body;
  if (typeof courseId !== 'string' || !UUID.test(courseId)) return Response.json({ error: 'courseId is required' }, { status: 400 });
  if (testType !== 'practice' && testType !== 'exam_simulation' && testType !== 'climb') return Response.json({ error: 'Unknown test type' }, { status: 400 });
  if (!Array.isArray(body.answers) || body.answers.length === 0 || body.answers.length > 100) {
    return Response.json({ error: 'answers are required' }, { status: 400 });
  }

  const answers: SubmittedAnswer[] = [];
  for (const raw of body.answers as unknown[]) {
    const a = raw as Record<string, unknown>;
    if (typeof a?.question_id !== 'string' || !UUID.test(a.question_id)) return Response.json({ error: 'Bad answer' }, { status: 400 });
    answers.push({
      question_id: a.question_id,
      selected: Array.isArray(a.selected) ? a.selected.filter((s): s is string => typeof s === 'string').slice(0, 10).map(s => s.slice(0, 500)) : [],
      confidence: a.confidence === 'sure' || a.confidence === 'unsure' ? a.confidence : null,
    });
  }

  const db = serviceClient();

  // Typed answers that aren't a word-for-word match get the same AI check
  // as the "Check" button. Only the ones it accepts are passed on.
  const fillOk: string[] = [];
  const { data: fills } = await db.from('questions')
    .select('id, question_text, correct_answers')
    .in('id', answers.map(a => a.question_id))
    .eq('question_type', 'fill_in_blank');
  const toCheck = ((fills ?? []) as { id: string; question_text: string; correct_answers: string[] }[])
    .map(q => ({ q, typed: answers.find(a => a.question_id === q.id)?.selected[0] ?? '' }))
    .filter(({ q, typed }) => typed.trim() && !(q.correct_answers ?? []).some(c => normAnswer(c) === normAnswer(typed)))
    .slice(0, MAX_AI_CHECKS);
  const started = Date.now();
  await Promise.race([
    Promise.all(toCheck.map(async ({ q, typed }) => {
      try {
        if (await fillAnswerCorrect(q.question_text, q.correct_answers?.[0] ?? '', typed, auth.userId)) fillOk.push(q.id);
      } catch (err) {
        console.error('[tests/submit] fill check failed', err);
      }
    })),
    new Promise(resolve => setTimeout(resolve, AI_BUDGET_MS)),
  ]);
  const accepted = [...fillOk];
  const aiMs = Date.now() - started;

  const args = {
    p_user: auth.userId,
    p_course: courseId,
    p_topic: typeof topicId === 'string' && UUID.test(topicId) ? topicId : null,
    p_type: testType,
    p_answers: answers,
    p_time_taken: typeof timeTaken === 'number' && Number.isFinite(timeTaken) ? Math.round(timeTaken) : null,
    p_fill_ok: accepted,
  };
  let { data, error } = await db.rpc('record_test', args);
  // A known refusal is final. Anything else (a dropped connection, a
  // deadlock with another save) gets one more try before giving up.
  const known = (e: typeof error) => !!e && Object.keys(ERRORS).some(k => e.message?.includes(k));
  if (error && !known(error)) {
    await new Promise(resolve => setTimeout(resolve, 500));
    ({ data, error } = await db.rpc('record_test', args));
  }
  const row = (data as { test_id: string; score: number; total: number }[] | null)?.[0];

  if (error || !row) {
    const code = error ? Object.keys(ERRORS).find(k => error.message?.includes(k)) : undefined;
    if (code) return Response.json({ error: ERRORS[code] }, { status: 400 });
    // Keep the real reason where we can read it later: Vercel's logs only
    // last an hour. Admins: feature_events where event = 'test_save_failed'.
    const ref = Math.random().toString(36).slice(2, 8).toUpperCase();
    const detail = error ? { message: error.message, code: error.code, details: error.details, hint: error.hint } : { message: 'record_test returned no row' };
    console.error('[tests/submit] record_test failed', ref, detail);
    await db.from('feature_events').insert({
      user_id: auth.userId,
      event: 'test_save_failed',
      metadata: { ref, ...detail, course_id: courseId, test_type: testType, answers: answers.length, ai_checks: toCheck.length, ai_ms: aiMs },
    }).then(() => {}, () => {});
    return Response.json({ error: `Could not save your results (ref ${ref}). Please try again.` }, { status: 500 });
  }

  // Per-question marks, so the page can update spaced repetition without
  // re-marking anything itself.
  const { data: marks } = await db.from('test_answers').select('question_id, is_correct').eq('test_id', row.test_id);
  return Response.json({ testId: row.test_id, score: row.score, total: row.total, marks: marks ?? [] });
}
