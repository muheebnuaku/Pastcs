import type { createClient } from '@/lib/supabase/client';
import { coursesForProgram } from '@/lib/programs';
import type { Course } from '@/types';

type Db = ReturnType<typeof createClient>;

/**
 * The courses for a programme's level and semester. Courses are only
 * readable signed in (RLS), and a request sent while the login is still
 * being restored or refreshed (on reload, or coming back from the
 * Paystack window) goes out signed out and gets an empty list with no
 * error — which the page showed as "No courses available". An empty
 * answer is therefore checked: once the session is back, ask again.
 */
export async function loadLevelCourses(
  supabase: Db, programId: string, level: number, semester: number
): Promise<{ data: Course[]; error: string | null }> {
  const ask = () => coursesForProgram(supabase, programId).eq('level', level).eq('semester', semester).order('course_code');
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await ask();
    if (error) return { data: [], error: error.message };
    if ((data ?? []).length > 0) return { data: data as Course[], error: null };
    // Empty: genuinely no courses, or the login wasn't ready yet.
    const { data: { session } } = await supabase.auth.getSession();
    if (session && attempt > 0) return { data: [], error: null };
    await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
  }
  return { data: [], error: null };
}
