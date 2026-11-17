import { createClient } from '@/lib/supabase/server';
import type { SkillCourse } from '@/lib/skills';

// The skill courses on sale, for server-rendered pages. Empty if the
// database can't be reached (or migration 052 hasn't run yet).
export async function getSkillCourses(): Promise<SkillCourse[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_skill_courses');
    if (error) {
      console.error('[skills] get_skill_courses failed', error.message);
      return [];
    }
    return ((data ?? []) as SkillCourse[]).map(c => ({ ...c, outcomes: c.outcomes ?? [] }));
  } catch {
    return [];
  }
}
