import { createClient } from '@/lib/supabase/server';
import { maybeRewardPendingReferrer } from '@/lib/referralReward';

const VALID_LEVELS = [100, 200, 300, 400];
const VALID_SEMESTERS = [1, 2];

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();

    if (!authUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { level, semester, programId } = await request.json();

    if (!level || !semester || !programId) {
      return Response.json({ error: 'level, semester, and programId are required' }, { status: 400 });
    }

    if (!VALID_LEVELS.includes(level)) {
      return Response.json({ error: 'Invalid level' }, { status: 400 });
    }

    if (!VALID_SEMESTERS.includes(semester)) {
      return Response.json({ error: 'Invalid semester' }, { status: 400 });
    }

    const { data: program } = await supabase
      .from('programs')
      .select('id')
      .eq('id', programId)
      .single();

    if (!program) {
      return Response.json({ error: 'Invalid program' }, { status: 400 });
    }

    // Changing level/semester/program resets the free course selection —
    // it may not even exist in the new program's catalog.
    const { error } = await supabase
      .from('user_public')
      .update({
        selected_level: level,
        selected_semester: semester,
        program_id: programId,
        free_course_code: null,
      })
      .eq('id', authUser.id);

    if (error) throw error;

    // If they referred someone who already finished their first test
    // before this user had a level to grant a free pass against, catch
    // that reward up now. Never let this block the selection itself.
    maybeRewardPendingReferrer(authUser.id, level, semester).catch(() => {});

    return Response.json({ success: true });
  } catch (error) {
    console.error('Error updating selection:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
