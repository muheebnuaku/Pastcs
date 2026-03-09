import { createClient } from '@/lib/supabase/server';

const VALID_LEVELS = [100, 200, 300, 400];
const VALID_SEMESTERS = [1, 2];

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();

    if (!authUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { level, semester } = await request.json();

    if (!level || !semester) {
      return Response.json({ error: 'level and semester are required' }, { status: 400 });
    }

    if (!VALID_LEVELS.includes(level)) {
      return Response.json({ error: 'Invalid level' }, { status: 400 });
    }

    if (!VALID_SEMESTERS.includes(semester)) {
      return Response.json({ error: 'Invalid semester' }, { status: 400 });
    }

    // Changing level/semester resets the free course selection
    const { error } = await supabase
      .from('user_public')
      .update({
        selected_level: level,
        selected_semester: semester,
        free_course_code: null,
      })
      .eq('id', authUser.id);

    if (error) throw error;

    return Response.json({ success: true });
  } catch (error) {
    console.error('Error updating selection:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
