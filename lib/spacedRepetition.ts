import type { createClient } from '@/lib/supabase/client';

// Referencing the return type of our own client factory (rather than
// importing SupabaseClient from @supabase/supabase-js directly) avoids
// a real cross-version generic mismatch between the installed
// @supabase/ssr and @supabase/supabase-js — see reset-password/page.tsx
// for the full story. This function only ever receives that client.
type Db = ReturnType<typeof createClient>;

// 1 -> 3 -> 7 -> 14 -> 30, then plateaus. A wrong answer always resets
// to the first rung regardless of where a question was.
const INTERVAL_LADDER = [1, 3, 7, 14, 30];

export function nextReviewInterval(currentIntervalDays: number, wasCorrect: boolean): number {
  if (!wasCorrect) return INTERVAL_LADDER[0];
  const next = INTERVAL_LADDER.find(days => days > currentIntervalDays);
  return next ?? INTERVAL_LADDER[INTERVAL_LADDER.length - 1];
}

interface AnswerResult {
  questionId: string;
  correct: boolean;
}

/**
 * Call once per submitted test (practice or exam) with every question
 * answered. Upserts each question's review_schedule row so "Due for
 * review" practice always reflects the latest attempt. Never throws —
 * this is bookkeeping, not something that should block a student
 * seeing their results.
 */
export async function updateReviewSchedule(
  supabase: Db,
  userId: string,
  results: AnswerResult[]
): Promise<void> {
  if (results.length === 0) return;
  try {
    const questionIds = results.map(r => r.questionId);
    const { data: existing } = await supabase
      .from('review_schedule')
      .select('question_id, interval_days')
      .eq('user_id', userId)
      .in('question_id', questionIds);

    const existingMap = new Map(
      ((existing ?? []) as { question_id: string; interval_days: number }[])
        .map(r => [r.question_id, r.interval_days])
    );

    const today = new Date();
    const rows = results.map(({ questionId, correct }) => {
      const current = existingMap.get(questionId) ?? 0;
      const interval = nextReviewInterval(current, correct);
      const nextDate = new Date(today);
      nextDate.setDate(nextDate.getDate() + interval);
      return {
        user_id: userId,
        question_id: questionId,
        interval_days: interval,
        next_review_at: nextDate.toISOString().slice(0, 10),
        last_result: correct,
        updated_at: new Date().toISOString(),
      };
    });

    await supabase.from('review_schedule').upsert(rows, { onConflict: 'user_id,question_id' });
  } catch {
    // review_schedule not migrated on this environment yet, or a
    // transient failure — never block the results page over this.
  }
}
