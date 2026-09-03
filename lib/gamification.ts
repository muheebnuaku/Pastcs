import type { createClient } from '@/lib/supabase/client';

// Referencing the return type of our own client factory (rather than
// importing SupabaseClient from @supabase/supabase-js directly) avoids
// a real cross-version generic mismatch between the installed
// @supabase/ssr and @supabase/supabase-js — see spacedRepetition.ts /
// reset-password/page.tsx for the full story. This function only ever
// receives that client.
type Db = ReturnType<typeof createClient>;

interface CompletedTestInfo {
  courseId: string;
  testType: 'practice' | 'exam_simulation';
  score: number;              // correct answers
  totalQuestions: number;
  percentage: number;
  timeTaken: number | null;   // seconds, if tracked
}

interface AchievementCriteria {
  type: string;
  value: number;
}

interface AchievementRow {
  id: string;
  criteria: AchievementCriteria;
}

/**
 * Awards XP and checks/unlocks achievements right after a test or exam
 * simulation is saved. Both the practice and exam pages insert into
 * `tests` directly from the client (there is no shared submit endpoint),
 * so this lives here instead of an API route and is called from both.
 *
 * Best-effort: every failure is swallowed after a console.warn — this
 * must never block the student from reaching the results page.
 */
export async function recordTestGamification(
  supabase: Db,
  userId: string,
  test: CompletedTestInfo
): Promise<void> {
  const xpEarned =
    test.score * 10 +
    (test.testType === 'exam_simulation' && test.percentage >= 70 ? 50 : 0);

  const xpPromise = supabase
    .rpc('increment_xp', { p_user_id: userId, p_amount: xpEarned })
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.warn('Failed to award XP:', error.message);
    });

  await Promise.all([xpPromise, awardAchievements(supabase, userId, test)]);
}

async function awardAchievements(
  supabase: Db,
  userId: string,
  test: CompletedTestInfo
): Promise<void> {
  try {
    const [
      { data: achievements },
      { data: earnedRows },
      { data: userRow },
      { count: totalTests },
      { data: courseRows },
    ] = await Promise.all([
      supabase.from('achievements').select('id, criteria'),
      supabase.from('user_achievements').select('achievement_id').eq('user_id', userId),
      supabase.from('users').select('practice_streak').eq('id', userId).single(),
      supabase.from('tests').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('tests').select('course_id').eq('user_id', userId),
    ]);

    if (!achievements || achievements.length === 0) return;

    const earnedIds = new Set(
      (earnedRows ?? []).map((r: { achievement_id: string }) => r.achievement_id)
    );
    const coursesPracticed = new Set(
      (courseRows ?? []).map((r: { course_id: string }) => r.course_id)
    ).size;
    const streak = (userRow as { practice_streak?: number } | null)?.practice_streak ?? 0;

    const newlyEarned: string[] = [];

    for (const achievement of achievements as AchievementRow[]) {
      if (earnedIds.has(achievement.id)) continue;
      const { type, value } = achievement.criteria;
      let earned = false;

      switch (type) {
        case 'tests_completed':
          earned = (totalTests ?? 0) >= value;
          break;
        case 'perfect_score':
          earned = test.percentage >= 100;
          break;
        case 'streak':
          earned = streak >= value;
          break;
        case 'speed':
          earned = !!test.timeTaken && test.timeTaken > 0 && test.timeTaken <= value;
          break;
        case 'courses_practiced':
          earned = coursesPracticed >= value;
          break;
      }

      if (earned) newlyEarned.push(achievement.id);
    }

    if (newlyEarned.length === 0) return;

    const { error } = await supabase
      .from('user_achievements')
      .insert(newlyEarned.map(achievement_id => ({ user_id: userId, achievement_id })));

    if (error) console.warn('Failed to record earned achievements:', error.message);
  } catch (err) {
    console.warn('Achievement check failed:', err);
  }
}
