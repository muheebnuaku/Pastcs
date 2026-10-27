import type { SupabaseClient } from '@supabase/supabase-js';
import { coursePriceFor } from '@/lib/coursePricing';

/**
 * The rep's programme and the classroom's level, then the price per
 * classmate. Shared by the quote and start routes so the rep is charged
 * exactly what they were shown.
 */
export async function priceGroupPayment(
  admin: SupabaseClient,
  payerId: string,
  classroomId: string
): Promise<{ level: number; semester: number; programId: string; unitAmount: number } | { error: string }> {
  const [{ data: payer }, { data: room }] = await Promise.all([
    admin.from('users').select('program_id').eq('id', payerId).maybeSingle(),
    admin.from('classrooms').select('id, course:courses(level, semester)').eq('id', classroomId).maybeSingle(),
  ]);
  const programId = (payer as { program_id: string | null } | null)?.program_id;
  const course = (room as { course?: { level: number; semester: number } | null } | null)?.course;
  if (!programId) return { error: 'wrong_program' };
  if (!course) return { error: 'not_a_member' };
  const unitAmount = await coursePriceFor(admin, programId, course.level);
  return { level: course.level, semester: course.semester, programId, unitAmount };
}
