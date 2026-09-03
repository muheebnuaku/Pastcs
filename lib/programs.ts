import type { createClient } from '@/lib/supabase/client';

// Referencing the return type of our own client factory (rather than
// importing SupabaseClient from @supabase/supabase-js directly) avoids
// a real cross-version generic mismatch — see lib/gamification.ts.
type Db = ReturnType<typeof createClient>;

/**
 * Base courses query scoped to one program via the course_programs
 * join — a course only comes back if an admin has explicitly assigned
 * it to this program (course_programs is many-to-many and
 * admin-controlled; there's no automatic sharing by category). Chain
 * further `.eq()` / `.order()` / `.select()` overrides as needed —
 * this only sets the join + program filter.
 */
export function coursesForProgram(supabase: Db, programId: string) {
  return supabase
    .from('courses')
    .select('*, course_programs!inner(program_id)')
    .eq('course_programs.program_id', programId);
}

/**
 * Same scoping as coursesForProgram(), but for a head-only exact count
 * (e.g. "how many courses at this level are unlocked"). Don't chain a
 * second `.select()` onto coursesForProgram() for a count instead of
 * using this — PostgREST's embedded-table filter (course_programs.
 * program_id) only stays valid while that embed is still part of the
 * select column list, and a later `.select()` call replaces it rather
 * than merging.
 */
export function courseCountForProgram(supabase: Db, programId: string) {
  return supabase
    .from('courses')
    .select('id, course_programs!inner(program_id)', { count: 'exact', head: true })
    .eq('course_programs.program_id', programId);
}
